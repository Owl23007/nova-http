import { describe, expect, it } from "vitest";
import { BufferReader } from "../src/core/BufferReader";
import { HttpParser } from "../src/core/HttpParser";
import { NovaRequest } from "../src/core/NovaRequest";

function parseRaw(raw: string, parser = new HttpParser()) {
  const reader = new BufferReader();
  reader.feed(Buffer.from(raw, "latin1"));
  return parser.parse(reader);
}

describe("HttpParser", () => {
  it("UT-HTTP-01 parses a GET request line", () => {
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

  it("UT-HTTP-02 preserves query string and exposes pathname on request object", () => {
    const result = parseRaw("GET /users?id=1 HTTP/1.1\r\nHost: localhost\r\n\r\n");

    expect(result.done).toBe(true);
    if ("request" in result) {
      const req = new NovaRequest(result.request, {} as any);

      expect(req.path).toBe("/users?id=1");
      expect(req.pathname).toBe("/users");
      expect(req.query.get("id")).toBe("1");
    }
  });

  it("UT-HTTP-03 parses a JSON body with Content-Length", () => {
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

  it("UT-HTTP-04 parses and joins a chunked request body", () => {
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

  it("UT-HTTP-05 rejects an invalid request line", () => {
    const result = parseRaw("GET /\r\nHost: localhost\r\n\r\n");

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(400);
  });

  it("UT-HTTP-06 rejects bodies larger than maxBodySize", () => {
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

  it("UT-HTTP-07 rejects conflicting Content-Length and Transfer-Encoding headers", () => {
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

  it("allows parser limits to be configured", () => {
    const result = parseRaw(
      "GET /long HTTP/1.1\r\nHost: localhost\r\n\r\n",
      new HttpParser({ maxRequestLineLength: 8 }),
    );

    expect(result.done).toBe(true);
    expect("error" in result && result.error.code).toBe(400);
  });
});
