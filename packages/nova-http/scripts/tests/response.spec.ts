import { Application } from "../../src/core";
import type { ResponseSink } from "../../src/message/response-sink";
import { EventEmitter } from "events";
import type { Socket } from "net";
import { describe, expect, it, vi } from "vitest";
import { HeaderBlock, IncomingBody, NovaRequest, NovaResponse } from "../../src/core";
import { Http1ResponseSink } from "../../src/server/http1-response-sink";

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
): {
  response: NovaResponse;
  request: NovaRequest;
  socket: FakeSocket;
  controller: AbortController;
} {
  const socket = new FakeSocket();
  const controller = new AbortController();
  const body = new IncomingBody(false, 64 * 1024, () => undefined);
  body._complete();
  const request = new NovaRequest(
    {
      method: options.method ?? "GET",
      clientIp: "127.0.0.1",
      rawTarget: "/",
      path: "/",
      version: options.httpVersion ?? "1.1",
      headers: new HeaderBlock(),
      body,
      trailers: new HeaderBlock(),
      connection: { close: !(options.keepAlive ?? true), connect: false },
      peer: {},
    },
    controller.signal,
  );
  const sink = new Http1ResponseSink(
    socket as unknown as Socket,
    request.method,
    request.httpVersion,
    request.connection.close,
    request.signal,
  );
  return {
    response: new NovaResponse(sink, {
      signal: controller.signal,
      onFailure: (error) => {
        controller.abort(error);
        socket.destroy();
      },
    }),
    controller,
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

describe("响应边界", () => {
  it("读取响应头后修改数组不能注入字段或修改已提交的头", async () => {
    const { response, socket } = createResponse();
    response.setHeader("x-values", ["safe"]);
    (response.getHeader("x-values") as string[]).push("bad\r\nx-injected: yes");
    const committed = response.flushHeaders();
    (response.getHeader("x-values") as string[])[0] = "changed";
    await committed;
    await response.end();
    expect(response.getHeader("x-values")).toEqual(["safe"]);
    expect(socket.output()).toContain("x-values: safe\r\n");
    expect(socket.output()).not.toContain("x-injected");
    expect(socket.output()).not.toContain("changed");
  });

  it.each(["end", "send"])("%s 在输出阶段取消后不得恢复成功或继续写入", async (mode) => {
    for (const stage of ["commit", "write", "end"] as const) {
      const { request, controller } = createResponse();
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const sink: ResponseSink = {
        reusable: true,
        bodyBytesWritten: 0,
        assertHeaderAllowed() {},
        commit: vi.fn(async () => {}),
        write: vi.fn(async () => {}),
        end: vi.fn(async () => {}),
      };
      sink[stage] = vi.fn(async () => {
        entered();
        await gate;
      });
      const response = new NovaResponse(sink, {
        signal: controller.signal,
        onFailure: (error) => controller.abort(error),
      });
      if (mode === "send") response.send("body");
      const finished = mode === "end" ? response.end("body") : response._waitForFinish();
      const reason = new Error("取消输出");
      const rejection = expect(finished).rejects.toBe(reason);
      await started;
      controller.abort(reason);
      release();
      await rejection;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(response.writableEnded).toBe(false);
      expect(response._canReuseConnection).toBe(false);
      await expect(response._waitForFinish()).rejects.toBe(reason);
      if (stage === "commit") expect(sink.write).not.toHaveBeenCalled();
      if (stage !== "end") expect(sink.end).not.toHaveBeenCalled();
    }
  });

  it("取消后不执行排队中的输出", async () => {
    const { response, request, socket, controller } = createResponse();
    const pending = response.write("queued");
    const reason = new Error("取消排队写入");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(socket.output()).toBe("");
  });

  it.each(["end", "write", "send"])("已取消请求的 %s 不再输出", async (mode) => {
    const { response, request, controller } = createResponse();
    const reason = new Error("提前取消");
    controller.abort(reason);
    if (mode === "send") response.send("body");
    const pending =
      mode === "end"
        ? response.end()
        : mode === "write"
          ? response.write("body")
          : response._waitForFinish();
    await expect(pending).rejects.toBe(reason);
    expect(response.writableEnded).toBe(false);
  });
});

describe("应用完成通知", () => {
  it("嵌套应用各自收到一次完成通知且保留对应路径视图", async () => {
    const parent = new Application();
    const child = new Application();
    const nested = new Application();
    const calls: string[] = [];
    for (const [name, app] of [
      ["parent", parent],
      ["child", child],
      ["nested", nested],
    ] as const) {
      app.addHook("onResponse", ({ req, res }) => {
        expect(res.writableEnded).toBe(true);
        calls.push(`${name}:${req.pathname}`);
      });
    }
    nested.get("/", (_req: NovaRequest, res: NovaResponse) => {
      res.send("done");
    });
    child.use("/nested", nested);
    parent.use("/api", child);
    const original = createResponse();
    const req = original.request._createView("/api/nested");
    await parent.dispatch(req, original.response);
    expect(calls).toEqual(["nested:/", "child:/nested", "parent:/api/nested"]);
  });

  it("中止响应不发布成功通知且不影响后续请求", async () => {
    const parent = new Application();
    const child = new Application();
    const calls: string[] = [];
    parent.addHook("onResponse", () => {
      calls.push("parent");
    });
    child.addHook("onResponse", () => {
      calls.push("child");
    });
    child.get("/abort", async (_req: NovaRequest, res: NovaResponse) => {
      await res.write("partial");
      throw new Error("输出失败");
    });
    child.get("/ok", (_req: NovaRequest, res: NovaResponse) => {
      res.send("done");
    });
    parent.use("/api", child);
    const failed = createResponse();
    await parent.dispatch(failed.request._createView("/api/abort"), failed.response);
    expect(calls).toEqual([]);
    const succeeded = createResponse();
    await parent.dispatch(succeeded.request._createView("/api/ok"), succeeded.response);
    expect(calls).toEqual(["child", "parent"]);
  });
});

describe("响应成功终态", () => {
  it.each(["end", "send"])("%s 完成后的取消不改变写队列结果", async (mode) => {
    const { response, request, socket, controller } = createResponse();
    if (mode === "send") {
      response.send("done");
      await response._waitForFinish();
    } else {
      await response.end("done");
    }
    const output = socket.output();
    controller.abort(new Error("完成后断开"));
    expect(request.signal.aborted).toBe(true);
    expect(response.writableEnded).toBe(true);
    await expect(response.flushHeaders()).resolves.toBeUndefined();
    await expect(response._waitForFinish()).resolves.toBeUndefined();
    await expect(response.end()).resolves.toBeUndefined();
    await expect(response.write("late")).rejects.toMatchObject({
      code: "ERR_STREAM_WRITE_AFTER_END",
    });
    expect(socket.output()).toBe(output);
  });
});

describe("取消权限与失败通知", () => {
  function setup() {
    const controller = new AbortController();
    const onFailure = vi.fn();
    const sink: ResponseSink = {
      reusable: true,
      bodyBytesWritten: 0,
      assertHeaderAllowed() {},
      commit: vi.fn(async () => {}),
      write: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
    };
    const response = new NovaResponse(sink, { signal: controller.signal, onFailure });
    return { response, controller, onFailure, sink };
  }

  it.each(["commit", "write", "end"] as const)(
    "%s 失败只上报一次且响应不能自行取消交互",
    async (stage) => {
      const { response, controller, onFailure, sink } = setup();
      const error = new Error("输出失败");
      sink[stage] = vi.fn(async () => {
        throw error;
      });
      await expect(response.end("body")).rejects.toBe(error);
      await expect(response._waitForFinish()).rejects.toBe(error);
      response._fail(new Error("重复失败"));
      expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);
      expect(controller.signal.aborted).toBe(false);
      controller.abort(new Error("后续取消"));
      await expect(response._waitForFinish()).rejects.toBe(error);
    },
  );

  it.each([false, true])("协调层取消只清理响应，不反向上报失败，已提交=%s", async (committed) => {
    const { response, controller, onFailure, sink } = setup();
    if (committed) await response.write("partial");
    const error = new Error("外部取消");
    const completion = response._waitForFinish();
    controller.abort(error);
    await expect(completion).rejects.toBe(error);
    await expect(response.end()).rejects.toBe(error);
    expect(response.headersSent).toBe(committed);
    expect(response.writableEnded).toBe(false);
    expect(onFailure).not.toHaveBeenCalled();
    expect(sink.end).not.toHaveBeenCalled();
  });

  it("预先取消的信号不会上报输出失败", async () => {
    const { sink, onFailure, controller } = setup();
    const error = new Error("预先取消");
    controller.abort(error);
    const response = new NovaResponse(sink, { signal: controller.signal, onFailure });
    await expect(response._waitForFinish()).rejects.toBe(error);
    await expect(response.write("body")).rejects.toBe(error);
    expect(response.headersSent).toBe(false);
    expect(onFailure).not.toHaveBeenCalled();
    expect(sink.commit).not.toHaveBeenCalled();
  });

  it("流源在提交前失败可以恢复，提交后失败必须通知协调层", async () => {
    for (const committed of [false, true]) {
      const { response, controller, onFailure } = setup();
      const error = new Error("流源失败");
      async function* source() {
        if (committed) yield "partial";
        throw error;
      }
      await expect(response.stream(source())).rejects.toBe(error);
      if (committed) {
        expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);
        await expect(response._waitForFinish()).rejects.toBe(error);
      } else {
        expect(onFailure).not.toHaveBeenCalled();
        await response.status(500).end("recovered");
        expect(response.writableEnded).toBe(true);
      }
      expect(controller.signal.aborted).toBe(false);
    }
  });

  it("处理器异常在提交前由错误中间件恢复", async () => {
    const { response, controller, onFailure } = setup();
    const app = new Application();
    const original = createResponse();
    const request = new NovaRequest(
      {
        method: "GET",
        clientIp: "",
        rawTarget: "/",
        path: "/",
        version: "1.1",
        headers: new HeaderBlock(),
        trailers: new HeaderBlock(),
        body: original.request.body,
        connection: { close: false, connect: false },
        peer: {},
      },
      controller.signal,
    );
    app.get("/", (_req: NovaRequest, _res: NovaResponse) => {
      throw new Error("可恢复错误");
    });
    app.use((_error: unknown, _req: NovaRequest, res: NovaResponse, _next: () => void) => {
      res.status(422).send("recovered");
    });
    await app.dispatch(request, response);
    expect(response.statusCode).toBe(422);
    expect(response.writableEnded).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
