import { describe, expect, it } from "vitest";
import { bodyParser } from "../../src/middlewares";

function makeReq(body: string, contentType: string) {
  return {
    body: Buffer.from(body, "utf8"),
    bodyParsed: undefined,
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
  it("UT-BODY-01 解析 JSON 请求体", () => {
    const req = makeReq('{"name":"nova"}', "application/json");
    const res = makeRes();
    let nextCalled = false;

    bodyParser()(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.bodyParsed).toEqual({ name: "nova" });
  });

  it("UT-BODY-02 解析 urlencoded 请求体", () => {
    const req = makeReq("name=nova&tag=http&tag=test", "application/x-www-form-urlencoded");
    const res = makeRes();

    bodyParser()(req as any, res as any, () => {});

    expect(req.bodyParsed).toEqual({ name: "nova", tag: ["http", "test"] });
  });

  it("UT-BODY-03 拒绝非法 JSON 请求体", () => {
    const req = makeReq("{bad", "application/json");
    const res = makeRes();
    let nextCalled = false;

    bodyParser()(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.code).toBe(400);
    expect(res.sent).toBe("Invalid JSON body");
  });

  it("UT-BODY-04 拒绝超过配置限制的请求体", () => {
    const req = makeReq("abcdef", "application/json");
    const res = makeRes();

    bodyParser({ maxSize: 3 })(req as any, res as any, () => {});

    expect(res.code).toBe(413);
    expect(res.sent).toBe("Payload Too Large");
  });
});
