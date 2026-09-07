import { once } from "events";
import { Socket } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type Nova, type NovaRequest, type NovaResponse } from "../../src";

let app: Nova | undefined;
let socket: Socket | undefined;

async function listen(testApp: Nova): Promise<number> {
  await testApp.listen(0, "127.0.0.1");
  const address = (testApp as any)._server.address();
  return address.port;
}

async function connect(port: number): Promise<{ socket: Socket; chunks: Buffer[] }> {
  const client = new Socket();
  const chunks: Buffer[] = [];
  client.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  client.connect(port, "127.0.0.1");
  await once(client, "connect");
  return { socket: client, chunks };
}

async function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("connection lifecycle", () => {
  afterEach(async () => {
    if (socket && !socket.destroyed) socket.destroy();
    await app?.close();
    socket = undefined;
    app = undefined;
  });

  it("does not apply the Keep-Alive idle timeout while processing the next request", async () => {
    app = createApp({
      keepAliveTimeout: 30,
      headersTimeout: 200,
      requestTimeout: 500,
    });
    app.get("/first", (_req: NovaRequest, res: NovaResponse) => {
      res.send("first");
    });
    app.get("/slow", async (_req: NovaRequest, res: NovaResponse) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      res.send("slow");
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;

    const firstResponse = once(socket, "data");
    socket.write("GET /first HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    await firstResponse;

    const ended = once(socket, "end");
    socket.write("GET /slow HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    await waitWithTimeout(ended, 500);

    const response = Buffer.concat(connection.chunks).toString("utf8");
    expect(response.match(/HTTP\/1\.1 200 OK/g)).toHaveLength(2);
    expect(response).toContain("slow");
  });

  it("restarts the Header timeout for a subsequent Keep-Alive request", async () => {
    app = createApp({
      keepAliveTimeout: 0,
      headersTimeout: 25,
      requestTimeout: 500,
    });
    app.get("/first", (_req: NovaRequest, res: NovaResponse) => {
      res.send("first");
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;

    const firstResponse = once(socket, "data");
    socket.write("GET /first HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    await firstResponse;

    const ended = once(socket, "end");
    socket.write("GET /incomplete HTTP/1.1\r\nHost:");
    await waitWithTimeout(ended, 500);

    const response = Buffer.concat(connection.chunks).toString("utf8");
    expect(response).toContain("HTTP/1.1 408 Request Timeout");
  });

  it("finishes a busy connection during graceful shutdown", async () => {
    let markStarted: (() => void) | undefined;
    let releaseHandler: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    app = createApp();
    app.get("/slow", async (_req: NovaRequest, res: NovaResponse) => {
      markStarted?.();
      await released;
      res.send("done");
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;
    socket.write("GET /slow HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    await started;

    const ended = once(socket, "end");
    const closed = app.close();
    releaseHandler?.();

    await waitWithTimeout(Promise.all([closed, ended]), 500);
    expect(Buffer.concat(connection.chunks).toString("utf8")).toContain("done");

    app = undefined;
  });

  it("keeps a pipelined request paused until the streaming response ends", async () => {
    let releaseStream: (() => void) | undefined;
    let markFirstChunk: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const firstChunkWritten = new Promise<void>((resolve) => {
      markFirstChunk = resolve;
    });
    let nextRouteCalled = false;

    app = createApp({ requestTimeout: 500 });
    app.get("/stream", async (_req: NovaRequest, res: NovaResponse) => {
      await res.write("first");
      markFirstChunk?.();
      await released;
      await res.end("last");
    });
    app.get("/next", (_req: NovaRequest, res: NovaResponse) => {
      nextRouteCalled = true;
      res.send("next");
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;
    const ended = once(socket, "end");
    const firstData = once(socket, "data");
    socket.write(
      [
        "GET /stream HTTP/1.1",
        "Host: localhost",
        "Connection: keep-alive",
        "",
        "",
        "GET /next HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );

    await waitWithTimeout(firstChunkWritten, 500);
    await waitWithTimeout(firstData, 500);
    expect(nextRouteCalled).toBe(false);
    expect(Buffer.concat(connection.chunks).toString("utf8")).toContain("5\r\nfirst\r\n");

    releaseStream?.();
    await waitWithTimeout(ended, 500);

    const response = Buffer.concat(connection.chunks).toString("utf8");
    expect(nextRouteCalled).toBe(true);
    expect(response.match(/HTTP\/1\.1 200 OK/g)).toHaveLength(2);
    expect(response).toContain("4\r\nlast\r\n0\r\n\r\n");
    expect(response).toContain("next");
  });

  it("allows an active response to finish after the client half-closes its request side", async () => {
    app = createApp({ requestTimeout: 500 });
    app.get("/delayed", async (_req: NovaRequest, res: NovaResponse) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await res.end("complete");
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;
    const ended = once(socket, "end");
    socket.end("GET /delayed HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");

    await waitWithTimeout(ended, 500);

    const response = Buffer.concat(connection.chunks).toString("utf8");
    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("8\r\ncomplete\r\n0\r\n\r\n");
  });

  it("aborts a started response when the handler returns without ending it", async () => {
    let observedError: unknown;
    app = createApp({ requestTimeout: 500 });
    app.addHook("onError", ({ error }) => {
      observedError = error;
    });
    app.get("/broken", async (_req: NovaRequest, res: NovaResponse) => {
      await res.write("partial");
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;
    const closed = once(socket, "close");
    socket.write("GET /broken HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");

    await waitWithTimeout(closed, 500);

    expect(observedError).toMatchObject({ code: "ERR_RESPONSE_NOT_ENDED" });
    expect(Buffer.concat(connection.chunks).toString("utf8")).not.toContain("0\r\n\r\n");
  });

  it("cancels the active stream source when the client disconnects", async () => {
    let sourceCancelled = false;
    let markFirstChunk: (() => void) | undefined;
    const firstChunkWritten = new Promise<void>((resolve) => {
      markFirstChunk = resolve;
    });

    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        let first = true;
        return {
          next: async () => {
            if (first) {
              first = false;
              return { done: false, value: "ready" };
            }
            return new Promise<IteratorResult<string>>(() => undefined);
          },
          return: async () => {
            sourceCancelled = true;
            return { done: true, value: undefined };
          },
        };
      },
    };

    app = createApp({ requestTimeout: 500 });
    app.get("/cancel", async (_req: NovaRequest, res: NovaResponse) => {
      markFirstChunk?.();
      await res.stream(source);
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;
    socket.write("GET /cancel HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await waitWithTimeout(firstChunkWritten, 500);
    socket.destroy();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sourceCancelled).toBe(true);
  });
});
