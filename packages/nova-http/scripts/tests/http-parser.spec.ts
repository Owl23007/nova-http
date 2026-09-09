import { describe, expect, it } from "vitest";
import { HeaderBlock } from "../../src/message";
import {
  buildRequestHead,
  createHeadScanState,
  DEFAULT_PARSER_LIMITS,
  parseHead,
  parseTrailers,
  resolveFraming,
  scanHead,
  SegmentedInput,
  takeScannedBlock,
} from "../../src/protocol/http1";
import type { Http1Error, ParsedHead } from "../../src/protocol/http1";

function parseRawHead(raw: string): ParsedHead | Http1Error {
  return parseHead(Buffer.from(raw, "latin1"), DEFAULT_PARSER_LIMITS);
}

function expectHead(raw: string): ParsedHead {
  const result = parseRawHead(raw);
  expect("fatal" in result).toBe(false);
  return result as ParsedHead;
}

describe("HTTP/1.1 head parser", () => {
  it("保留 method 大小写和原始 request-target", () => {
    const head = expectHead("get /users?id=1 HTTP/1.1\r\nHost: localhost\r\n\r\n");
    expect(head.method).toBe("get");
    expect(head.rawTarget).toBe("/users?id=1");
    expect(head.target.form).toBe("origin");
  });

  it("保留重复字段而不机械合并", () => {
    const head = expectHead(
      "GET / HTTP/1.1\r\nHost: localhost\r\nX-Test: one\r\nX-Test: two\r\n\r\n",
    );
    expect(head.headers.get("x-test")).toBe("one");
    expect(head.headers.getAll("x-test")).toEqual(["one", "two"]);
  });

  it("只按 SP 和 HTAB 去除 OWS", () => {
    const head = expectHead("GET / HTTP/1.1\r\nHost: localhost\r\nX-Test:\t value \t\r\n\r\n");
    expect(head.headers.get("x-test")).toBe("value");
  });

  it("拒绝裸 LF 和 obs-fold", () => {
    const input = new SegmentedInput();
    input.append(Buffer.from("GET / HTTP/1.1\nHost: localhost\r\n\r\n", "latin1"));
    expect(scanHead(input, createHeadScanState(), DEFAULT_PARSER_LIMITS)).toMatchObject({
      type: "error",
      error: { code: "HPE_LF_EXPECTED_CR" },
    });

    expect(parseRawHead("GET / HTTP/1.1\r\nHost: localhost\r\n folded\r\n\r\n")).toMatchObject({
      code: "HPE_OBSOLETE_FOLD",
    });
  });

  it("严格校验 Host 和 request-target form", () => {
    expect(parseRawHead("GET / HTTP/1.1\r\n\r\n")).toMatchObject({ code: "HPE_INVALID_HOST" });
    expect(parseRawHead("GET / HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n")).toMatchObject({
      code: "HPE_INVALID_HOST",
    });
    expect(parseRawHead("GET / HTTP/1.1\r\nHost: bad host\r\n\r\n")).toMatchObject({
      code: "HPE_INVALID_HOST",
    });
    expect(parseRawHead("GET * HTTP/1.1\r\nHost: a\r\n\r\n")).toMatchObject({
      code: "HPE_INVALID_TARGET_FORM",
    });
    expect(expectHead("OPTIONS * HTTP/1.1\r\nHost: a\r\n\r\n").target.form).toBe("asterisk");
    expect(
      expectHead("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n").target.form,
    ).toBe("authority");
  });

  it("跨任意 TCP 分段单调找到完整 head", () => {
    const raw = "GET /split HTTP/1.1\r\nHost: example.com\r\nX-Test: yes\r\n\r\nBODY";
    for (let split = 1; split < raw.length; split++) {
      const input = new SegmentedInput();
      const scanner = createHeadScanState();
      input.append(Buffer.from(raw.slice(0, split), "latin1"));
      const first = scanHead(input, scanner, DEFAULT_PARSER_LIMITS);
      if (first.type === "complete") continue;
      expect(first.type).toBe("need-data");
      input.append(Buffer.from(raw.slice(split), "latin1"));
      const second = scanHead(input, scanner, DEFAULT_PARSER_LIMITS);
      expect(second.type).toBe("complete");
      if (second.type === "complete") {
        const head = takeScannedBlock(input, second.length);
        expect(head.toString("latin1")).toBe(raw.slice(0, raw.indexOf("BODY")));
        expect(input.front()?.toString("latin1")).toBe("BODY");
      }
    }
  });

  it("支持每个字节独立成段的极端分包", () => {
    const raw = "GET /tiny HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const input = new SegmentedInput();
    const scanner = createHeadScanState();
    for (const byte of Buffer.from(raw, "latin1")) {
      input.append(Buffer.from([byte]));
      const result = scanHead(input, scanner, DEFAULT_PARSER_LIMITS);
      if (input.available < raw.length) expect(result.type).toBe("need-data");
      else expect(result).toEqual({ type: "complete", length: raw.length });
    }
  });
});

describe("HTTP/1.1 framing resolver", () => {
  it("拒绝 TE 与 CL 冲突", () => {
    const head = expectHead(
      "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n",
    );
    expect(resolveFraming(head)).toMatchObject({ code: "HPE_TE_CL_CONFLICT", status: 400 });
  });

  it("接受一致的重复 Content-Length 并拒绝不一致值", () => {
    const same = expectHead(
      "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nContent-Length: 5\r\n\r\n",
    );
    expect(resolveFraming(same)).toEqual({ type: "fixed", length: 5 });
    const different = expectHead("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5, 6\r\n\r\n");
    expect(resolveFraming(different)).toMatchObject({ code: "HPE_INVALID_CONTENT_LENGTH" });
    const emptyMember = expectHead("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5,,5\r\n\r\n");
    expect(resolveFraming(emptyMember)).toMatchObject({ code: "HPE_INVALID_CONTENT_LENGTH" });
  });

  it("仅支持最终且唯一的 chunked coding", () => {
    const chunked = expectHead("POST / HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\n\r\n");
    expect(buildRequestHead(chunked)).toMatchObject({ bodyPlan: { type: "chunked" } });
    const unsupported = expectHead(
      "POST / HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: gzip, chunked\r\n\r\n",
    );
    expect(resolveFraming(unsupported)).toMatchObject({ status: 501 });
  });

  it("无 framing 字段的请求没有 body", () => {
    const head = expectHead("POST / HTTP/1.1\r\nHost: a\r\n\r\n");
    expect(resolveFraming(head)).toEqual({ type: "none" });
  });

  it("Trailer 独立解析并保留重复项", () => {
    const trailers = parseTrailers(
      Buffer.from("X-Sum: one\r\nX-Sum: two\r\n\r\n", "latin1"),
      DEFAULT_PARSER_LIMITS,
    );
    expect(trailers).toBeInstanceOf(HeaderBlock);
    expect((trailers as HeaderBlock).getAll("x-sum")).toEqual(["one", "two"]);
  });

  it("拒绝会改变 framing 的 Trailer 字段", () => {
    const trailers = parseTrailers(
      Buffer.from("Content-Length: 5\r\n\r\n", "latin1"),
      DEFAULT_PARSER_LIMITS,
    );
    expect(trailers).toMatchObject({ code: "HPE_FORBIDDEN_TRAILER" });
  });
});
