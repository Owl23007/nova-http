import { EventEmitter } from "events";
import type { Socket } from "net";
import { describe, expect, it, vi } from "vitest";
import { Application, type NovaRequest, type NovaResponse } from "../../src/core";
import { Http1ConnectionCoordinator } from "../../src/server/http1-connection";

class TestSocket extends EventEmitter {
  destroyed = false;
  writable = true;
  writableNeedDrain = false;
  backpressure = false;
  readonly chunks: Buffer[] = [];
  readonly destroy = vi.fn(() => {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.writable = false;
    queueMicrotask(() => this.emit("close"));
    return this;
  });
  setNoDelay() {}
  setKeepAlive() {}
  setTimeout() {}
  pause() {}
  resume() {}
  cork() {}
  uncork() {}
  write(chunk: Buffer): boolean {
    this.chunks.push(Buffer.from(chunk));
    this.writableNeedDrain = this.backpressure;
    return !this.backpressure;
  }
  end(): void {
    this.destroy();
  }
}

function setup(dispatch: (req: NovaRequest, res: NovaResponse) => Promise<void>) {
  const socket = new TestSocket();
  const onError = vi.fn();
  const coordinator = new Http1ConnectionCoordinator(socket as unknown as Socket, {
    config: {
      headersTimeout: 0,
      keepAliveTimeout: 0,
      requestTimeout: 0,
      bodyIdleTimeout: 0,
      maxBodySize: 1024,
      bodyHighWaterMark: 1024,
      trustProxy: false,
    },
    dispatch,
    onConnect() {},
    onClose() {},
    onError,
  });
  return { socket, coordinator, onError };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const get = "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n";

describe("协调层交互生命周期", () => {
  it("背压中的响应取消后立即关闭传输，不等待处理器退出", async () => {
    let request!: NovaRequest;
    let response!: NovaResponse;
    let pending!: Promise<void>;
    const { socket, coordinator } = setup((req, res) => {
      request = req;
      response = res;
      pending = res.write("partial");
      return new Promise<void>(() => {});
    });
    socket.backpressure = true;
    socket.emit("data", Buffer.from(get));
    await tick();
    expect(socket.writableNeedDrain).toBe(true);
    const rejected = expect(pending).rejects.toMatchObject({ code: "ERR_SERVER_SHUTDOWN" });
    coordinator.gracefulClose();
    expect(socket.destroyed).toBe(true);
    await rejected;
    await expect(response._waitForFinish()).rejects.toBe(request.signal.reason);
    expect(response.writableEnded).toBe(false);
    const reason = request.signal.reason;
    coordinator.shutdown();
    expect(request.signal.reason).toBe(reason);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    await tick();
  });

  it("输出失败取消未完成的请求体读取，即使处理器仍在等待", async () => {
    let request!: NovaRequest;
    let output!: Promise<void>;
    let body!: Promise<Buffer>;
    const { socket } = setup((req, res) => {
      request = req;
      body = req.buffer();
      void body.catch(() => {});
      res.setHeader("content-length", "0");
      output = res.write("excess");
      void output.catch(() => {});
      return new Promise<void>(() => {});
    });
    socket.emit(
      "data",
      Buffer.from("POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\n"),
    );
    await expect(output).rejects.toMatchObject({ code: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" });
    await expect(body).rejects.toBe(request.signal.reason);
    expect(request.signal.aborted).toBe(true);
    expect(socket.destroyed).toBe(true);
    await tick();
  });

  it("同一连接上的请求使用独立信号，关闭新请求不改变旧响应", async () => {
    const requests: NovaRequest[] = [];
    const responses: NovaResponse[] = [];
    const { socket, coordinator } = setup(async (req, res) => {
      requests.push(req);
      responses.push(res);
      if (requests.length === 1) await res.end("first");
      else
        await new Promise<void>((resolve) =>
          req.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
    });
    socket.emit("data", Buffer.from(get));
    await tick();
    socket.emit("data", Buffer.from(get));
    expect(requests).toHaveLength(2);
    expect(requests[0].signal).not.toBe(requests[1].signal);
    coordinator.shutdown();
    expect(requests[0].signal.aborted).toBe(false);
    expect(requests[1].signal.aborted).toBe(true);
    expect(responses[0].writableEnded).toBe(true);
    await expect(responses[0]._waitForFinish()).resolves.toBeUndefined();
    await tick();
  });

  it("提交后处理器失败由协调层取消请求并关闭连接", async () => {
    const app = new Application();
    const error = new Error("提交后失败");
    let request!: NovaRequest;
    app.get("/", async (req: NovaRequest, res: NovaResponse) => {
      request = req;
      await res.write("partial");
      throw error;
    });
    const { socket } = setup((req, res) => app.dispatch(req, res));
    socket.emit("data", Buffer.from(get));
    await tick();
    expect(request.signal.reason).toBe(error);
    expect(socket.destroyed).toBe(true);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });
});
