import { describe, expect, it } from "vitest";
import { Hooks, type RequestLocals } from "../../src/core";
import { bodyParser } from "../../src/middlewares";

function makeReq(body: string, contentType: string) {
  return {
    buffer: async ({ maxSize }: { maxSize?: number } = {}) => {
      const value = Buffer.from(body, "utf8");
      if (maxSize !== undefined && value.length > maxSize) {
        throw new RangeError("Request body exceeds the configured limit");
      }
      return value;
    },
    context: {} as RequestLocals,
    headers: new Map([["content-type", contentType]]),
  };
}

function makeRes() {
  return {
    code: 200,
    sent: "",
    status(code: number) {
      this.code = code;
      return this;
    },
    send(data: string) {
      this.sent = data;
    },
  };
}

describe("bodyParser", () => {
  it("UT-BODY-01 解析 JSON 请求体", async () => {
    const req = makeReq('{"name":"nova"}', "application/json");
    const res = makeRes();
    let nextCalled = false;

    await bodyParser()(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.context.bodyParserData).toEqual({
      body: { name: "nova" },
      contentType: "application/json",
    });
  });

  it("UT-BODY-02 解析 urlencoded 请求体", async () => {
    const req = makeReq("name=nova&tag=http&tag=test", "application/x-www-form-urlencoded");
    const res = makeRes();

    await bodyParser()(req as any, res as any, () => {});

    expect(req.context.bodyParserData?.body).toEqual({ name: "nova", tag: ["http", "test"] });
  });

  it("UT-BODY-03 拒绝非法 JSON 请求体", async () => {
    const req = makeReq("{bad", "application/json");
    const res = makeRes();
    let nextCalled = false;

    await bodyParser()(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.code).toBe(400);
    expect(res.sent).toBe("Invalid JSON body");
  });

  it("UT-BODY-04 拒绝超过配置限制的请求体", async () => {
    const req = makeReq("abcdef", "application/json");
    const res = makeRes();

    await bodyParser({ maxSize: 3 })(req as any, res as any, () => {});

    expect(res.code).toBe(413);
    expect(res.sent).toBe("Payload Too Large");
  });

  it("UT-BODY-05 解析成功后触发 namespaced extension hook", async () => {
    const req = makeReq('{"name":"nova"}', "application/json");
    const res = makeRes();
    const hooks = new Hooks();
    const calls: string[] = [];

    hooks.addHook("bodyParser:parsed", ({ req: parsedReq, res: parsedRes, body, contentType }) => {
      expect(parsedReq).toBe(req);
      expect(parsedRes).toBe(res);
      expect(body).toEqual({ name: "nova" });
      expect(contentType).toBe("application/json");
      calls.push("parsed");
    });

    await bodyParser().call({ hooks }, req as any, res as any, () => {
      calls.push("next");
    });

    expect(calls).toEqual(["parsed", "next"]);
  });

  it("UT-BODY-06 未解析请求体时不触发 extension hook", async () => {
    const req = makeReq("plain text", "text/plain");
    const res = makeRes();
    const hooks = new Hooks();
    let parsedCalled = false;

    hooks.addHook("bodyParser:parsed", () => {
      parsedCalled = true;
    });

    await bodyParser().call({ hooks }, req as any, res as any, () => {});

    expect(parsedCalled).toBe(false);
  });

  it("UT-BODY-07 extension hook 不阻塞 middleware 控制流", async () => {
    const req = makeReq('{"name":"nova"}', "application/json");
    const res = makeRes();
    const hooks = new Hooks();
    let release!: () => void;
    let observationFinished = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observation = new Promise<void>((resolve) => {
      hooks.addHook("bodyParser:parsed", async () => {
        await gate;
        observationFinished = true;
        resolve();
      });
    });

    let nextCalled = false;
    await bodyParser().call({ hooks }, req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(observationFinished).toBe(false);

    release();
    await observation;
    expect(observationFinished).toBe(true);
  });
});

it.each(["application/problem+json", "Application/JSON; charset=utf-8"])(
  "parses JSON media type %s",
  async (type) => {
    const req = makeReq('{"ok":true}', type);
    await bodyParser()(req as any, makeRes() as any, () => {});
    expect(req.context.bodyParserData?.body).toEqual({ ok: true });
  },
);
it.each([
  "application/jsonp",
  "text/plain; type=application/json",
  "application/x-www-form-urlencoded-extra",
])("skips unrelated media type %s", async (type) => {
  const req = makeReq("invalid", type);
  await bodyParser()(req as any, makeRes() as any, () => {});
  expect(req.context.bodyParserData).toBeUndefined();
});
