import { once } from "events";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bodyParser,
  createApp,
  staticFiles,
  type Nova,
  type NovaRequest,
  type NovaResponse,
} from "../../src";

let app: Nova | undefined;
let tempDir: string | undefined;

async function listen(testApp: Nova): Promise<number> {
  await testApp.listen(0, "127.0.0.1");
  const address = (testApp as any)._server.address();
  return address.port;
}

async function request(port: number, raw: string): Promise<string> {
  const socket = new Socket();
  const chunks: Buffer[] = [];

  socket.connect(port, "127.0.0.1");
  await once(socket, "connect");
  socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  socket.write(raw);
  await once(socket, "end");

  return Buffer.concat(chunks).toString("utf8");
}

describe("Nova integration", () => {
  afterEach(async () => {
    await app?.close();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    app = undefined;
    tempDir = undefined;
  });

  it("IT-01 启动服务", async () => {
    app = createApp();

    const port = await listen(app);

    expect(port).toBeGreaterThan(0);
  });

  it("IT-02 JSON 接口", async () => {
    app = createApp();
    app.get("/hello", (_req: NovaRequest, res: NovaResponse) => {
      res.json({ message: "hello" });
    });

    const port = await listen(app);
    const response = await request(
      port,
      "GET /hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );

    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("content-type: application/json; charset=utf-8");
    expect(response).toContain('{"message":"hello"}');
  });

  it("IT-03 路由参数", async () => {
    app = createApp();
    app.get("/users/:id", (req: NovaRequest, res: NovaResponse) => {
      res.json({ id: req.params.id });
    });

    const port = await listen(app);
    const response = await request(
      port,
      "GET /users/1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );

    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain('{"id":"1"}');
  });

  it("IT-04 POST 请求体", async () => {
    app = createApp();
    app.use(bodyParser());
    app.post("/users", (req: NovaRequest, res: NovaResponse) => {
      res.json({ received: req.bodyParsed });
    });

    const port = await listen(app);
    const body = '{"name":"nova"}';
    const response = await request(
      port,
      [
        "POST /users HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "",
        body,
      ].join("\r\n"),
    );

    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain('{"received":{"name":"nova"}}');
  });

  it("IT-05 404 响应", async () => {
    app = createApp();

    const port = await listen(app);
    const response = await request(
      port,
      "GET /missing HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );

    expect(response).toContain("HTTP/1.1 404 Not Found");
    expect(response).toContain("Not Found");
  });

  it("IT-06 405 响应", async () => {
    app = createApp();
    app.get("/known", (_req: NovaRequest, res: NovaResponse) => {
      res.send("known");
    });

    const port = await listen(app);
    const response = await request(
      port,
      "POST /known HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );

    expect(response).toContain("HTTP/1.1 405 Method Not Allowed");
    expect(response).toContain("allow: GET");
  });

  it("IT-07 静态文件访问", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "nova-static-"));
    await writeFile(join(tempDir, "hello.txt"), "static hello", "utf8");

    app = createApp();
    app.use(staticFiles(tempDir));

    const port = await listen(app);
    const response = await request(
      port,
      "GET /hello.txt HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );

    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("content-type: text/plain; charset=utf-8");
    expect(response).toContain("static hello");
  });

  it("preserves Range, cache validation and HEAD behavior for streamed files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "nova-static-stream-"));
    await writeFile(join(tempDir, "hello.txt"), "static hello", "utf8");

    app = createApp();
    app.use(staticFiles(tempDir));
    const port = await listen(app);

    const rangeResponse = await request(
      port,
      [
        "GET /hello.txt HTTP/1.1",
        "Host: localhost",
        "Range: bytes=0-5",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
    expect(rangeResponse).toContain("HTTP/1.1 206 Partial Content");
    expect(rangeResponse).toContain("content-range: bytes 0-5/12");
    expect(rangeResponse.endsWith("\r\n\r\nstatic")).toBe(true);

    const initialResponse = await request(
      port,
      "GET /hello.txt HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    const etag = initialResponse.match(/\r\netag: ([^\r\n]+)/)?.[1];
    expect(etag).toBeDefined();

    const cachedResponse = await request(
      port,
      [
        "GET /hello.txt HTTP/1.1",
        "Host: localhost",
        `If-None-Match: ${etag}`,
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
    expect(cachedResponse).toContain("HTTP/1.1 304 Not Modified");
    expect(cachedResponse.endsWith("\r\n\r\n")).toBe(true);

    const headResponse = await request(
      port,
      "HEAD /hello.txt HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(headResponse).toContain("content-length: 12");
    expect(headResponse.endsWith("\r\n\r\n")).toBe(true);
  });

  it("IT-08 Keep-Alive 同一 TCP 连接处理多个请求", async () => {
    app = createApp();
    app.get("/first", (_req: NovaRequest, res: NovaResponse) => {
      res.send("first");
    });
    app.get("/second", (_req: NovaRequest, res: NovaResponse) => {
      res.send("second");
    });

    const port = await listen(app);
    const response = await request(
      port,
      [
        "GET /first HTTP/1.1",
        "Host: localhost",
        "Connection: keep-alive",
        "",
        "",
        "GET /second HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );

    expect(response.match(/HTTP\/1\.1 200 OK/g)).toHaveLength(2);
    expect(response).toContain("first");
    expect(response).toContain("second");
  });

  it("supports custom HTTP methods registered through app.method", async () => {
    app = createApp();
    app.method("PROPFIND", "/files", (_req: NovaRequest, res: NovaResponse) => {
      res.send("custom method");
    });

    const port = await listen(app);

    const response = await request(
      port,
      "PROPFIND /files HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );

    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("custom method");
  });

  it("treats HTTP methods as case-sensitive", async () => {
    app = createApp();
    app.get("/case", (_req: NovaRequest, res: NovaResponse) => res.send("upper"));
    app.method("get", "/case", (_req: NovaRequest, res: NovaResponse) => res.send("lower"));

    const port = await listen(app);
    const response = await request(
      port,
      "get /case HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(response).toContain("lower");
    expect(response).not.toContain("upper");
  });

  it("serves routes, parameters and JSON bodies over TCP", async () => {
    app = createApp();
    app.use(bodyParser());
    app.get("/", (_req: NovaRequest, res: NovaResponse) => {
      res.json({ ok: true });
    });
    app.get("/users/:id", (req: NovaRequest, res: NovaResponse) => {
      res.json({ id: req.params.id });
    });
    app.post("/echo", (req: NovaRequest, res: NovaResponse) => {
      res.json({ received: req.bodyParsed });
    });

    const port = await listen(app);

    const root = await request(
      port,
      "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(root).toContain("HTTP/1.1 200 OK");
    expect(root).toContain('{"ok":true}');

    const user = await request(
      port,
      "GET /users/42 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(user).toContain('{"id":"42"}');

    const body = '{"name":"nova"}';
    const echo = await request(
      port,
      [
        "POST /echo HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "",
        body,
      ].join("\r\n"),
    );
    expect(echo).toContain('{"received":{"name":"nova"}}');
  });

  it("emits onResponse for both mounted and parent apps after a stream ends", async () => {
    let childResponses = 0;
    let parentResponses = 0;
    const child = createApp();
    child.addHook("onResponse", () => {
      childResponses++;
    });
    child.get("/stream", async (_req: NovaRequest, res: NovaResponse) => {
      await res.write("mounted");
      expect(childResponses).toBe(0);
      expect(parentResponses).toBe(0);
      await res.end();
    });

    app = createApp();
    app.addHook("onResponse", () => {
      parentResponses++;
    });
    app.use("/api", child);

    const port = await listen(app);
    const response = await request(
      port,
      "GET /api/stream HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );

    expect(response).toContain("mounted");
    expect(childResponses).toBe(1);
    expect(parentResponses).toBe(1);
  });
});
