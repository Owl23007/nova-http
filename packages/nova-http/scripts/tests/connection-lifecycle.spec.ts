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
});
