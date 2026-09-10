import { createMountedRequest } from "../../src/core/mount";
import { describe, expect, it } from "vitest";
import { HeaderBlock, IncomingBody, NovaRequest } from "../../src/core";
import { parseHead, DEFAULT_PARSER_LIMITS } from "../../src/protocol/http1";
import { resolveClientIp, type TrustProxy } from "../../src/server/proxy";
import { createApp } from "../../src";

function request(
  rawTarget = "/",
  headers: Record<string, string> = {},
  trustProxy: TrustProxy = false,
  method = "GET",
  signal: AbortSignal = new AbortController().signal,
) {
  const head = parseHead(
    Buffer.from(`${method} ${rawTarget} HTTP/1.1\r\nHost: example.com\r\n\r\n`),
    DEFAULT_PARSER_LIMITS,
  );
  if ("fatal" in head) throw new Error(head.message);
  const fields = new HeaderBlock(Object.entries(headers).map(([name, value]) => ({ name, value })));
  return new NovaRequest(
    {
      clientIp: resolveClientIp({ remoteAddress: "127.0.0.1" }, fields, trustProxy),
      rawTarget: head.rawTarget,
      path: head.path,
      method: head.method,
      version: head.version,
      headers: fields,
      body: new IncomingBody(true, 16384, () => {}),
      trailers: new HeaderBlock(),
      connection: { close: false, connect: method === "CONNECT" },
      peer: { remoteAddress: "127.0.0.1" },
    },
    signal,
  );
}

describe("request semantics", () => {
  it.each(["/a/../b?x=1", "/%2e%2e/b?", "//a/%2F?q=%25", "/a/./b"])(
    "preserves path %s across target forms",
    (path) => {
      for (const target of [path, `http://example.com${path}`]) {
        const req = request(target);
        expect(req.path).toBe(path);
        expect(req.rawTarget).toBe(target);
        expect(req.pathname).toBe(path.split("?")[0]);
      }
    },
  );
  it.each([
    ["http://example.com", "/", "GET"],
    ["http://example.com?", "/?", "GET"],
    ["http://[::1]:80?q=1", "/?q=1", "GET"],
    ["*", "*", "OPTIONS"],
    ["example.com:443", "example.com:443", "CONNECT"],
  ])("extracts %s", (target, path, method) => {
    expect(request(target, {}, false, method).path).toBe(path);
  });
  it("preserves cookie values and has no inherited keys", () => {
    const cookies = request("/", {
      cookie: "a=%2F; bad=%ZZ; __proto__=safe; constructor=value; token=a=b",
    }).cookies;
    expect(Object.getPrototypeOf(cookies)).toBeNull();
    expect(cookies.a).toBe("%2F");
    expect(cookies.bad).toBe("%ZZ");
    expect(cookies.__proto__).toBe("safe");
    expect(cookies.constructor).toBe("value");
    expect(cookies.token).toBe("a=b");
    expect(cookies.toString).toBeUndefined();
  });
  it.each([
    ["Application/JSON; charset=utf-8", true, false],
    ["application/problem+json", true, false],
    ["application/jsonp", false, false],
    ["text/plain; foo=application/json", false, false],
    ["APPLICATION/X-WWW-FORM-URLENCODED; charset=utf-8", false, true],
    ["application/x-www-form-urlencoded-extra", false, false],
    ["text/problem+json", false, false],
  ])("classifies %s", (type, json, form) => {
    const req = request("/", { "content-type": type });
    expect(req.isJson).toBe(json);
    expect(req.isForm).toBe(form);
  });
  it("counts received bytes before completion", () => {
    const req = request();
    expect(req.bodyBytesReceived).toBe(0);
    req.body._accept(Buffer.from("你好"));
    expect(req.bodyBytesReceived).toBe(6);
    expect(req.body.messageComplete).toBe(false);
    req.body._complete();
    expect(req.bodyBytesReceived).toBe(6);
  });
  it.each([false, true])("retains the first abort reason with eager signal=%s", (eager) => {
    const controller = new AbortController();
    const req = request("/", {}, false, "GET", controller.signal);
    const signal = eager ? req.signal : undefined;
    const reason = new Error("cancelled");
    controller.abort(reason);
    controller.abort(new Error("later"));
    expect(req.signal.aborted).toBe(true);
    expect(req.signal.reason).toBe(reason);
    if (signal) expect(req.signal).toBe(signal);
  });
  it("walks only trusted proxy hops", () => {
    const headers = { "x-forwarded-for": "192.0.2.1, 198.51.100.1" };
    expect(request("/", headers).ip).toBe("127.0.0.1");
    expect(request("/", headers, 0).ip).toBe("127.0.0.1");
    expect(request("/", headers, 1).ip).toBe("198.51.100.1");
    expect(request("/", headers, true).ip).toBe("192.0.2.1");
    expect(request("/", headers, (ip, hop) => ip === "127.0.0.1" && hop === 0).ip).toBe(
      "198.51.100.1",
    );
    expect(request("/", { "x-forwarded-for": "192.0.2.1, invalid" }, true).ip).toBe("127.0.0.1");
    expect(request("/", { "x-real-ip": "192.0.2.1" }, true).ip).toBe("127.0.0.1");
  });
  it.each([-1, 0.5, Infinity, NaN])(
    "rejects invalid trusted hop count %s at configuration time",
    (trustProxy) => {
      expect(() => createApp({ trustProxy })).toThrow(RangeError);
    },
  );
  it.each([null, "all", {}, []])("rejects invalid trust proxy policy %j", (trustProxy) => {
    expect(() => createApp({ trustProxy } as never)).toThrow(TypeError);
  });
  it("rejects a non-boolean trust proxy decision", () => {
    expect(() => request("/", { "x-forwarded-for": "192.0.2.1" }, (() => "yes") as never)).toThrow(
      TypeError,
    );
  });
});

describe("请求边界", () => {
  it.each(["parent", "child", "late"])("挂载视图共享取消状态，首次访问信号为 %s", (first) => {
    const controller = new AbortController();
    const parent = request("/api/nested/item?q=1", {}, false, "GET", controller.signal);
    const child = createMountedRequest(parent, "/api");
    const nested = createMountedRequest(child, "/nested");
    if (first === "parent") void parent.signal;
    if (first === "child") void nested.signal;
    const reason = new Error("取消请求");
    controller.abort(reason);
    expect(nested.signal).toBe(parent.signal);
    expect(child.signal.reason).toBe(reason);
    expect(nested.signal.aborted).toBe(true);
    expect(nested.pathname).toBe("/item");
    expect(parent.pathname).toBe("/api/nested/item");
  });

  it("协调层取消后所有挂载视图保留首次取消原因", () => {
    const controller = new AbortController();
    const parent = request("/api/item", {}, false, "GET", controller.signal);
    const child = createMountedRequest(parent, "/api");
    const reason = new Error("取消子请求");
    controller.abort(reason);
    controller.abort(new Error("再次取消"));
    expect(parent.signal.reason).toBe(reason);
    expect(child.signal).toBe(parent.signal);
  });

  it("请求头持有独立且不可变的字段快照", () => {
    const fields = [{ name: "X-Test", value: "safe" }];
    const headers = new HeaderBlock(fields);
    expect(headers.get("x-test")).toBe("safe");
    fields[0].value = "changed";
    fields.push({ name: "extra", value: "value" });
    expect(headers.fields).toEqual([{ name: "x-test", value: "safe" }]);
    expect(Object.isFrozen(headers.fields)).toBe(true);
    expect(Object.isFrozen([...headers][0])).toBe(true);
    const trailers = [{ name: "X-Trailer", value: "done" }];
    headers._replace(trailers);
    trailers[0].value = "changed";
    expect(headers.get("x-test")).toBeUndefined();
    expect(headers.get("x-trailer")).toBe("done");
  });
});

describe("请求视图", () => {
  it("路径和解析缓存独立，请求数据与上下文共享", () => {
    const parent = request("/api/item?q=parent", { cookie: "token=original" });
    parent.params = { outer: "value" };
    const view = parent._createView("/item?q=child");
    expect(Object.getPrototypeOf(view)).toBe(NovaRequest.prototype);
    expect(view.rawTarget).toBe(parent.rawTarget);
    expect(view.pathname).toBe("/item");
    expect(view.params).toEqual({});
    expect(view.context).toBe(parent.context);
    expect(view.body).toBe(parent.body);
    expect(view.headers).toBe(parent.headers);
    expect(view.trailers).toBe(parent.trailers);
    view.query.set("q", "changed");
    view.cookies.token = "changed";
    expect(parent.query.get("q")).toBe("parent");
    expect(parent.cookies.token).toBe("original");
    expect(view.signal).toBe(parent.signal);
  });
});
