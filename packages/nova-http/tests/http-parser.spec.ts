import { describe, expect, it } from "vitest";
import { BufferReader, HttpParser, NovaRequest } from "../src/core";

// 将原始 HTTP 报文写入 BufferReader，模拟 TCP 层收到字节流后的解析过程。
function parseRaw(raw: string, parser = new HttpParser()) {
  const reader = new BufferReader();
  reader.feed(Buffer.from(raw, "latin1"));
  return parser.parse(reader);
}

function feedAndParse(reader: BufferReader, parser: HttpParser, raw: string) {
  reader.feed(Buffer.from(raw, "latin1"));
  return parser.parse(reader);
}

describe("HttpParser", () => {
  it("UT-HTTP-01 解析 GET 请求行", () => {
    // 验证最基础的请求行解析：方法、路径、HTTP 版本和 Host 头都应被正确读取。
    const result = parseRaw("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");

    expect(result.done).toBe(true);
    if ("request" in result) {
      expect(result.request.method).toBe("GET");
      expect(result.request.path).toBe("/");
      expect(result.request.httpVersion).toBe("1.1");
      expect(result.request.headers.get("host")).toBe("localhost");
      expect(result.request.keepAlive).toBe(true);
    }
  });

  it("UT-HTTP-02 保留查询字符串并解析 pathname", () => {
    // HttpParser 保留完整 path，NovaRequest 负责进一步拆分 pathname 和 query。
    const result = parseRaw("GET /users?id=1 HTTP/1.1\r\nHost: localhost\r\n\r\n");

    expect(result.done).toBe(true);
    if ("request" in result) {
      const req = new NovaRequest(result.request, {} as any);

      expect(req.path).toBe("/users?id=1");
      expect(req.pathname).toBe("/users");
      expect(req.query.get("id")).toBe("1");
    }
  });

  it("UT-HTTP-03 解析带 Content-Length 的 JSON Body", () => {
    // 固定长度 body 依赖 Content-Length，解析结果必须和原始 JSON 字符串完全一致。
    const body = JSON.stringify({ name: "nova" });
    const result = parseRaw(
      [
        "POST /echo HTTP/1.1",
        "Host: localhost",
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "",
        body,
      ].join("\r\n"),
    );

    expect(result.done).toBe(true);
    if ("request" in result) {
      expect(result.request.method).toBe("POST");
      expect(result.request.body.toString("utf8")).toBe(body);
      expect(result.request.body.byteLength).toBe(Buffer.byteLength(body));
    }
  });

  it("UT-HTTP-04 解析并合并 Chunked Body", () => {
    // chunked body 按块读取，最终应合并为一个连续的请求体 Buffer。
    const result = parseRaw(
      [
        "POST /chunk HTTP/1.1",
        "Host: localhost",
        "Transfer-Encoding: chunked",
        "",
        "5",
        "hello",
        "6",
        " nova",
        "0",
        "",
        "",
      ].join("\r\n"),
    );

    expect(result.done).toBe(true);
    if ("request" in result) {
      expect(result.request.body.toString("utf8")).toBe("hello nova");
    }
  });

  it("UT-HTTP-05 拒绝非法请求行", () => {
    // 缺少 HTTP 版本的请求行不符合格式要求，应返回 400 解析错误。
    const result = parseRaw("GET /\r\nHost: localhost\r\n\r\n");

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(400);
  });

  it("UT-HTTP-06 拒绝超过 maxBodySize 的 Body", () => {
    // 将 maxBodySize 设置为 3 字节，构造 6 字节 body，验证超限时返回 413。
    const body = "abcdef";
    const maxBodySize = 3;
    const result = parseRaw(
      [
        "POST /upload HTTP/1.1",
        "Host: localhost",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "",
        body,
      ].join("\r\n"),
      new HttpParser({ maxBodySize }),
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(413);
  });

  it("UT-HTTP-07 拒绝 Content-Length 和 Transfer-Encoding 冲突", () => {
    // 同时出现 CL 和 TE 存在请求走私风险，解析器应直接拒绝该请求。
    const result = parseRaw(
      [
        "POST /bad HTTP/1.1",
        "Host: localhost",
        "Content-Length: 5",
        "Transfer-Encoding: chunked",
        "",
        "0",
        "",
        "",
      ].join("\r\n"),
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(400);
  });

  it("UT-HTTP-08 支持配置解析器限制项", () => {
    // 额外验证解析器的限制项可配置，避免安全阈值只能使用内置默认值。
    const result = parseRaw(
      "GET /long HTTP/1.1\r\nHost: localhost\r\n\r\n",
      new HttpParser({ maxRequestLineLength: 8 }),
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(400);
  });
  it("UT-HTTP-09 支持分包解析固定长度 Body", () => {
    const parser = new HttpParser();
    const reader = new BufferReader();

    const first = feedAndParse(
      reader,
      parser,
      "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhe",
    );
    expect(first.done).toBe(false);

    const second = feedAndParse(reader, parser, "llo");
    expect(second.done).toBe(true);
    if ("request" in second) {
      expect(second.request.body.toString("utf8")).toBe("hello");
    }
  });

  it("UT-HTTP-10 支持同一连接连续解析多个 Keep-Alive 请求", () => {
    const parser = new HttpParser();
    const reader = new BufferReader();
    reader.feed(
      Buffer.from(
        "GET /one HTTP/1.1\r\nHost: localhost\r\n\r\nGET /two HTTP/1.1\r\nHost: localhost\r\n\r\n",
        "latin1",
      ),
    );

    const first = parser.parse(reader);
    const second = parser.parse(reader);

    expect("request" in first && first.request.path).toBe("/one");
    expect("request" in second && second.request.path).toBe("/two");
  });

  it("UT-HTTP-11 正确计算 HTTP/1.0 和 Connection 头的 keepAlive", () => {
    const http10 = parseRaw("GET / HTTP/1.0\r\nHost: localhost\r\n\r\n");
    const http11Close = parseRaw("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");

    expect("request" in http10 && http10.request.keepAlive).toBe(false);
    expect("request" in http11Close && http11Close.request.keepAlive).toBe(false);
  });

  it("UT-HTTP-12 允许重复且一致的 Content-Length", () => {
    const result = parseRaw(
      "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\nContent-Length: 5\r\n\r\nhello",
    );

    expect(result.done).toBe(true);
    if ("request" in result) {
      expect(result.request.body.toString("utf8")).toBe("hello");
    }
  });

  it("UT-HTTP-13 拒绝重复但不一致的 Content-Length", () => {
    const result = parseRaw(
      "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\nhello!",
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(400);
  });

  it("UT-HTTP-14 请求头行超限时返回 431", () => {
    const result = parseRaw(
      "GET / HTTP/1.1\r\nHost: localhost\r\nX-Long: abc\r\n\r\n",
      new HttpParser({ maxHeaderLineLength: 8 }),
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(431);
  });

  it("UT-HTTP-15 请求头数量超限时返回 431", () => {
    const result = parseRaw(
      "GET / HTTP/1.1\r\nHost: localhost\r\nX-Test: 1\r\n\r\n",
      new HttpParser({ maxHeadersCount: 1 }),
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(431);
  });

  it("UT-HTTP-16 拒绝非法 Header 名称", () => {
    const result = parseRaw("GET / HTTP/1.1\r\nBad Header: value\r\n\r\n");

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(400);
  });

  it("UT-HTTP-17 拒绝非法 chunk size", () => {
    const result = parseRaw(
      "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\nZ\r\nhello\r\n0\r\n\r\n",
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(400);
  });

  it("UT-HTTP-18 拒绝 chunk data 后缺少 CRLF 的请求", () => {
    const result = parseRaw(
      "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhelloXX0\r\n\r\n",
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(400);
  });

  it("UT-HTTP-19 chunk data 分包时不会提前消费未完成的数据", () => {
    const parser = new HttpParser();
    const reader = new BufferReader();

    const first = feedAndParse(
      reader,
      parser,
      "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello",
    );
    expect(first.done).toBe(false);

    const second = feedAndParse(reader, parser, "\r\n0\r\n\r\n");
    expect(second.done).toBe(true);
    if ("request" in second) {
      expect(second.request.body.toString("utf8")).toBe("hello");
    }
  });

  it("UT-HTTP-20 拒绝超过 maxBodySize 的 chunked body", () => {
    const result = parseRaw(
      "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
      new HttpParser({ maxBodySize: 3 }),
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(413);
  });
});
