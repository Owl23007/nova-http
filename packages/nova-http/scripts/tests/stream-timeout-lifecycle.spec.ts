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

describe("stream timeout lifecycle", () => {
  afterEach(async () => {
    if (socket && !socket.destroyed) socket.destroy();
    await app?.close();
    socket = undefined;
    app = undefined;
  });

  it("keeps requestTimeout protection for ordinary async handlers", async () => {
    app = createApp({ requestTimeout: 30 });
    app.get("/slow", async (_req: NovaRequest, res: NovaResponse) => {
      await new Promise<void>(() => undefined);
      res.send("never");
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;
    const ended = once(socket, "end");
    socket.write("GET /slow HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");

    await waitWithTimeout(ended, 500);
    expect(Buffer.concat(connection.chunks).toString("utf8")).toContain("408 Request Timeout");
  });

  it("does not apply requestTimeout after a response enters streaming mode", async () => {
    let releaseStream: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });

    app = createApp({ requestTimeout: 30 });
    app.get("/stream", async (_req: NovaRequest, res: NovaResponse) => {
      await res.write("ready");
      await released;
      await res.end("done");
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;
    const firstData = once(socket, "data");
    const ended = once(socket, "end");
    socket.write("GET /stream HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");

    await waitWithTimeout(firstData, 500);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(socket.destroyed).toBe(false);

    releaseStream?.();
    await waitWithTimeout(ended, 500);

    const response = Buffer.concat(connection.chunks).toString("utf8");
    expect(response).toContain("5\r\nready\r\n");
    expect(response).toContain("4\r\ndone\r\n0\r\n\r\n");
    expect(response).not.toContain("408 Request Timeout");
  });

  it("terminates a long-lived streaming response during graceful shutdown", async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    app = createApp({ requestTimeout: 30 });
    app.get("/events", async (req: NovaRequest, res: NovaResponse) => {
      await res.write(": connected\n\n");
      markStarted?.();
      await new Promise<void>((resolve) => {
        req.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    });

    const port = await listen(app);
    const connection = await connect(port);
    socket = connection.socket;
    const closed = once(socket, "close");
    socket.write("GET /events HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    await waitWithTimeout(started, 500);

    const closing = app.close();
    await waitWithTimeout(Promise.all([closing, closed]), 500);

    expect(Buffer.concat(connection.chunks).toString("utf8")).toContain(": connected");
    app = undefined;
  });
});
