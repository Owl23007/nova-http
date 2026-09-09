import { describe, expect, it } from "vitest";
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
  it("UT-BODY-01 解析 JSON 请求体", async () => {
    const req = makeReq('{"name":"nova"}', "application/json");
    const res = makeRes();
    let nextCalled = false;

    await bodyParser()(req as any, res as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.bodyParsed).toEqual({ name: "nova" });
  });

  it("UT-BODY-02 解析 urlencoded 请求体", async () => {
    const req = makeReq("name=nova&tag=http&tag=test", "application/x-www-form-urlencoded");
    const res = makeRes();

    await bodyParser()(req as any, res as any, () => {});

    expect(req.bodyParsed).toEqual({ name: "nova", tag: ["http", "test"] });
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
});
