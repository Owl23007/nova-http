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
) {
  const head = parseHead(
    Buffer.from(`${method} ${rawTarget} HTTP/1.1\r\nHost: example.com\r\n\r\n`),
    DEFAULT_PARSER_LIMITS,
  );
  if ("fatal" in head) throw new Error(head.message);
  const fields = new HeaderBlock(Object.entries(headers).map(([name, value]) => ({ name, value })));
  return new NovaRequest({
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
  });
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
    const req = request();
    const signal = eager ? req.signal : undefined;
    const reason = new Error("cancelled");
    req._abort(reason);
    req._abort(new Error("later"));
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
