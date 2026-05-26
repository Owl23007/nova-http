import { once } from "events";
import { Socket } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { bodyParser, createApp, type Nova } from "../src";

let app: Nova | undefined;

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
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.write(raw);
  await once(socket, "end");

  return Buffer.concat(chunks).toString("utf8");
}

describe("Nova integration", () => {
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("serves routes, parameters and JSON bodies over TCP", async () => {
    app = createApp();
    app.use(bodyParser());
    app.get("/", (_req, res) => res.json({ ok: true }));
    app.get("/users/:id", (req, res) => res.json({ id: req.params.id }));
    app.post("/echo", (req, res) => res.json({ received: req.bodyParsed }));

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

  it("returns 404 and 405 responses", async () => {
    app = createApp();
    app.get("/known", (_req, res) => res.send("known"));

    const port = await listen(app);

    const missing = await request(
      port,
      "GET /missing HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(missing).toContain("HTTP/1.1 404 Not Found");

    const wrongMethod = await request(
      port,
      "POST /known HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    expect(wrongMethod).toContain("HTTP/1.1 405 Method Not Allowed");
    expect(wrongMethod).toContain("allow: GET");
  });
});
