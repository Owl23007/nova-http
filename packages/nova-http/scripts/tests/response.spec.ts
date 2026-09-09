import { EventEmitter } from "events";
import type { Socket } from "net";
import { describe, expect, it } from "vitest";
import { HeaderBlock, IncomingBody, NovaRequest, NovaResponse } from "../../src/core";

class FakeSocket extends EventEmitter {
  readonly chunks: Buffer[] = [];
  destroyed = false;
  writable = true;
  writableNeedDrain = false;
  backpressureNextWrite = false;

  setNoDelay(): void {}
  setKeepAlive(): void {}
  setTimeout(): void {}
  pause(): void {}
  resume(): void {}
  cork(): void {}
  uncork(): void {}

  write(chunk: Uint8Array | string): boolean {
    this.chunks.push(Buffer.from(chunk));
    if (this.backpressureNextWrite) {
      this.backpressureNextWrite = false;
      this.writableNeedDrain = true;
      return false;
    }
    return true;
  }

  releaseDrain(): void {
    this.writableNeedDrain = false;
    this.emit("drain");
  }

  destroy(): this {
    this.destroyed = true;
    this.writable = false;
    return this;
  }

  output(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function createResponse(
  options: {
    method?: string;
    httpVersion?: "1.0" | "1.1";
    keepAlive?: boolean;
  } = {},
): { response: NovaResponse; request: NovaRequest; socket: FakeSocket } {
  const socket = new FakeSocket();
  const body = new IncomingBody(false, 64 * 1024, () => undefined);
  body._complete();
  const request = new NovaRequest(
    {
      method: options.method ?? "GET",
      rawTarget: "/",
      target: { form: "origin", raw: "/" },
      version: options.httpVersion ?? "1.1",
      headers: new HeaderBlock(),
      body,
      trailers: new HeaderBlock(),
      bodyPlan: { type: "none" },
      connection: { close: !(options.keepAlive ?? true), connect: false },
    },
    socket as unknown as Socket,
  );
  return {
    response: new NovaResponse(socket as unknown as Socket, request),
    request,
    socket,
  };
}

describe("NovaResponse", () => {
  it("rejects invalid header names and values", () => {
    const { response } = createResponse();

    expect(() => response.setHeader("x-valid\r\ninjected", "value")).toThrow(TypeError);
    expect(() => response.setHeader("x-valid", "value\r\nx-injected: true")).toThrow(TypeError);
    expect(() => response.setHeader("x-valid", ["safe", "unsafe\nvalue"])).toThrow(TypeError);
  });

  it("copies header arrays so later mutations cannot inject values", () => {
    const { response } = createResponse();
    const values = ["safe"];

    response.setHeader("x-values", values);
    values.push("unsafe\r\nx-injected: true");

    expect(response.getHeader("x-values")).toEqual(["safe"]);
  });

  it("rejects invalid status codes", () => {
    const { response } = createResponse();

    expect(() => response.status(99)).toThrow(RangeError);
    expect(() => response.status(1000)).toThrow(RangeError);
    expect(() => response.status(200.5)).toThrow(RangeError);
  });

  it("rejects response splitting through redirect locations", () => {
    const { response } = createResponse();

    expect(() => response.redirect("/safe\r\nx-injected: true")).toThrow(TypeError);
  });

  it("encodes unknown-length HTTP/1.1 bodies with chunked framing", async () => {
    const { response, socket } = createResponse();

    await response.write("hello");
    await response.write(" nova");
    await response.end();

    expect(socket.output()).toBe(
      "HTTP/1.1 200 OK\r\n" +
        "server: Nova\r\n" +
        "transfer-encoding: chunked\r\n" +
        "\r\n" +
        "5\r\nhello\r\n" +
        "5\r\n nova\r\n" +
        "0\r\n\r\n",
    );
    expect(response.writableEnded).toBe(true);
    expect(response.bodyBytesWritten).toBe(10);
  });

  it("uses raw framing and validates an explicit Content-Length", async () => {
    const { response, socket } = createResponse();
    response.setHeader("content-length", "5");

    await response.end("hello");

    expect(socket.output()).toContain("content-length: 5\r\n");
    expect(socket.output()).not.toContain("transfer-encoding");
    expect(socket.output().endsWith("\r\n\r\nhello")).toBe(true);
  });

  it("destroys the connection when a fixed-length stream is short", async () => {
    const { response, socket } = createResponse();
    response.setHeader("content-length", "5");

    await response.write("hey");
    await expect(response.end()).rejects.toMatchObject({
      code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    });

    expect(socket.destroyed).toBe(true);
  });

  it("waits for drain before resolving a backpressured write", async () => {
    const { response, socket } = createResponse();
    await response.flushHeaders();
    socket.backpressureNextWrite = true;

    let settled = false;
    const writePromise = response.write("slow").finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    socket.releaseDrain();
    await writePromise;
    await response.end();
  });

  it("streams an async iterable in source order", async () => {
    const { response, socket } = createResponse();

    async function* source() {
      yield "a";
      yield Buffer.from("b");
      yield new Uint8Array([0x63]);
    }

    await response.stream(source());

    expect(socket.output()).toContain("1\r\na\r\n1\r\nb\r\n1\r\nc\r\n0\r\n\r\n");
  });

  it("does not send a body for HEAD requests", async () => {
    const { response, socket } = createResponse({ method: "HEAD" });
    response.setHeader("content-length", "5");

    await response.end("hello");

    expect(socket.output()).toContain("content-length: 5\r\n");
    expect(socket.output().endsWith("\r\n\r\n")).toBe(true);
    expect(response.bodyBytesWritten).toBe(0);
  });

  it("freezes headers and rejects writes after end", async () => {
    const { response } = createResponse();
    await response.end();

    expect(() => response.setHeader("x-late", "value")).toThrow(
      expect.objectContaining({ code: "ERR_HTTP_HEADERS_SENT" }),
    );
    await expect(response.write("late")).rejects.toMatchObject({
      code: "ERR_STREAM_WRITE_AFTER_END",
    });
  });

  it("uses close-delimited framing for unknown-length HTTP/1.0 streams", async () => {
    const { response, socket } = createResponse({ httpVersion: "1.0" });

    await response.write("legacy");
    await response.end();

    expect(socket.output()).toContain("HTTP/1.0 200 OK\r\n");
    expect(socket.output()).toContain("connection: close\r\n");
    expect(socket.output()).not.toContain("transfer-encoding");
    expect(response._canReuseConnection).toBe(false);
  });

  it("keeps the response reusable when a stream source fails before headers", async () => {
    const { response, socket } = createResponse();

    async function* source() {
      throw new Error("source failed");
    }

    await expect(response.stream(source())).rejects.toThrow("source failed");
    expect(response.headersSent).toBe(false);
    expect(socket.output()).toBe("");
    expect(socket.destroyed).toBe(false);
  });

  it("destroys the connection when a stream source fails after headers", async () => {
    const { response, socket } = createResponse();

    async function* source() {
      yield "partial";
      throw new Error("source failed");
    }

    await expect(response.stream(source())).rejects.toThrow("source failed");
    expect(socket.output()).toContain("7\r\npartial\r\n");
    expect(socket.output()).not.toContain("0\r\n\r\n");
    expect(socket.destroyed).toBe(true);
  });

  it("suppresses bodies for status codes that do not allow a payload", async () => {
    const { response, socket } = createResponse();
    response.status(204);

    await response.end("ignored");

    expect(socket.output()).toContain("HTTP/1.1 204 No Content");
    expect(socket.output()).not.toContain("ignored");
    expect(socket.output()).not.toContain("transfer-encoding");
  });

  it("suppresses bodies and emits a zero length for 205 responses", async () => {
    const { response, socket } = createResponse();
    response.status(205);

    await response.end("ignored");

    expect(socket.output()).toContain("HTTP/1.1 205 Reset Content");
    expect(socket.output()).toContain("content-length: 0\r\n");
    expect(socket.output()).not.toContain("ignored");
    expect(socket.output()).not.toContain("transfer-encoding");
  });

  it("keeps Transfer-Encoding under framework control", () => {
    const { response } = createResponse();

    expect(() => response.setHeader("transfer-encoding", "chunked")).toThrow(
      expect.objectContaining({ code: "ERR_MANAGED_RESPONSE_HEADER" }),
    );
  });
});
