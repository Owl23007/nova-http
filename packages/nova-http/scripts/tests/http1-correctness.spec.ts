import { once } from "node:events";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type Nova, type NovaRequest, type NovaResponse } from "../../src";
import {
  DEFAULT_PARSER_LIMITS,
  parseHead,
  resolveFraming,
  resolveConnectionIntent,
  resolveResponsePlan,
} from "../../src/protocol/http1";
import { isHttp1Error, parseChunkSize } from "../../src/protocol/http1/parser";
import { Http1ResponseSink } from "../../src/server/http1-response-sink";

function head(target = "/", method = "GET", fields = "", version = "1.1") {
  const parsed = parseHead(
    Buffer.from(
      `${method} ${target} HTTP/${version}\r\nHost: header.test:80\r\n${fields}\r\n`,
      "latin1",
    ),
    DEFAULT_PARSER_LIMITS,
  );
  if (isHttp1Error(parsed)) throw new Error(parsed.code);
  return parsed;
}

function framing(value: string) {
  return resolveFraming(head("/", "POST", `Transfer-Encoding: ${value}\r\n`));
}

describe("HTTP/1 frozen semantics", () => {
  it("ignores HTTP/1.0 Upgrade and gives explicit close priority", () => {
    const fields = "Connection: upgrade, keep-alive\r\nUpgrade: websocket\r\n";
    expect(resolveConnectionIntent(head("/", "GET", fields, "1.0"))).toEqual({
      close: false,
      connect: false,
    });
    expect(resolveConnectionIntent(head("/", "GET", fields))).toMatchObject({
      close: false,
      upgrade: "websocket",
    });
    expect(
      resolveConnectionIntent(head("/", "GET", "Connection: keep-alive, close\r\n", "1.0")).close,
    ).toBe(true);
  });

  it.each([
    ["/a?b=1", "GET", "header.test:80"],
    ["http://target.test:8080/a?b=1", "GET", "target.test:8080"],
    ["[::1]:443", "CONNECT", "[::1]:443"],
    ["target.test:443", "CONNECT", "target.test:443"],
    ["*", "OPTIONS", "header.test:80"],
  ])("selects authority for %s without rewriting Host", (target, method, authority) => {
    const parsed = head(target, method);
    expect(parsed.authority).toBe(authority);
    expect(parsed.headers.get("host")).toBe("header.test:80");
    expect(parsed.rawTarget).toBe(target);
  });

  it("leaves HTTP/1.0 authority absent when no Host is supplied", () => {
    expect(parseHead(Buffer.from("GET / HTTP/1.0\r\n\r\n"), DEFAULT_PARSER_LIMITS)).toMatchObject({
      authority: undefined,
    });
  });

  it.each([
    "/bad%",
    "/bad%0",
    "/bad%GG",
    "/back\\slash",
    "/bad[bracket]",
    "/?q=[x]",
    "/#fragment",
    "http://a/bad%0",
  ])("rejects invalid URI boundary %s", (target) => {
    expect(
      parseHead(Buffer.from(`GET ${target} HTTP/1.1\r\nHost: a\r\n\r\n`), DEFAULT_PARSER_LIMITS),
    ).toMatchObject({ status: 400, code: "HPE_INVALID_TARGET" });
  });

  it.each(["/a/../b%2f?x=%FF&url=a/b?c", "/?", "/a;:@!$&'()*+,=~-._", "//a//b", "http://a?x=%00"])(
    "preserves legal URI syntax %s",
    (target) => {
      expect(head(target).rawTarget).toBe(target);
    },
  );

  it.each(["chunked", "ChUnKeD", ",chunked,", " , , chunked , "])(
    "accepts supported Transfer-Encoding list %s",
    (value) => {
      expect(framing(value)).toEqual({ type: "chunked" });
    },
  );

  it.each([
    "gzip; level=1, chunked",
    'custom; note="a,b;\\\"c", chunked',
    "gzip; level = token, chunked",
  ])("classifies grammatical unsupported coding %s as 501", (value) => {
    expect(framing(value)).toMatchObject({
      type: "unsupported",
      status: 501,
      code: "HPE_UNSUPPORTED_TRANSFER_CODING",
    });
  });

  it.each([
    "",
    ", ,",
    "chunked,chunked",
    "chunked,gzip,chunked",
    "chunked;x=1",
    "gzip;x,chunked",
    "gzip;x=,chunked",
    'gzip;x="open,chunked',
    'gzip;x="ok"oops,chunked',
    "gzip / chunked",
    "chunked;",
    ",".repeat(17) + "chunked",
  ])("classifies malformed Transfer-Encoding %s as 400", (value) => {
    expect(framing(value)).toMatchObject({
      type: "framing",
      status: 400,
      code: "HPE_INVALID_TRANSFER_ENCODING",
    });
  });

  it("requires final chunked and rejects HTTP/1.0 transfer coding", () => {
    expect(framing("gzip")).toMatchObject({ status: 400, code: "HPE_FINAL_TRANSFER_CODING" });
    expect(framing("chunked,gzip")).toMatchObject({ status: 400 });
    expect(
      resolveFraming(head("/", "POST", "Transfer-Encoding: chunked\r\n", "1.0")),
    ).toMatchObject({ status: 400 });
    expect(
      resolveFraming(
        head("/", "POST", "Transfer-Encoding: gzip\r\nTransfer-Encoding: chunked\r\n"),
      ),
    ).toMatchObject({ status: 501 });
    expect(framing(",".repeat(16) + "chunked")).toEqual({ type: "chunked" });
  });

  it.each([
    "a",
    "000a",
    "a;flag",
    "a ; flag ; name = token",
    'a;name=""',
    'a;name="a,b;\\\"c"',
    'a\t;name="\t\xff"',
    "0;end=yes",
  ])("accepts chunk extension grammar %s", (line) => {
    expect(parseChunkSize(Buffer.from(line, "latin1"))).toBe(line.startsWith("0;") ? 0 : 10);
  });

  it.each([
    "a;",
    "a;=x",
    "a;name=",
    "a;name=x y",
    'a;name="open',
    'a;name="ok"oops',
    'a;name="bad\x7f"',
    'a;name="bad\\\x01"',
    "a;name=\xff",
    "a ",
    "a;flag ",
    "a;flag;;next",
  ])("rejects invalid chunk extension %s", (line) => {
    expect(parseChunkSize(Buffer.from(line, "latin1"))).toMatchObject({
      code: "HPE_INVALID_CHUNK_EXTENSION",
      status: 400,
    });
  });

  it("rejects nonhex sizes and safely handles overflow and leading zeroes", () => {
    for (const line of ["", "x", ";a", " a", "+a"])
      expect(parseChunkSize(Buffer.from(line))).toMatchObject({ code: "HPE_INVALID_CHUNK_SIZE" });
    expect(parseChunkSize(Buffer.from("20000000000000"))).toMatchObject({
      code: "HPE_CHUNK_SIZE_OVERFLOW",
      status: 413,
    });
    expect(parseChunkSize(Buffer.from("0".repeat(100) + "1"))).toBe(1);
  });

  it.each([200, 204, 205, 299])("never frames CONNECT %s as an HTTP body", (status) => {
    const plan = resolveResponsePlan(
      "CONNECT",
      "1.1",
      false,
      status,
      new Map([
        ["content-length", "42"],
        ["transfer-encoding", "chunked"],
      ]),
    );
    expect(plan).toMatchObject({ mode: "none", contentLength: null, reusable: false });
    expect(plan.headers.has("content-length")).toBe(false);
    expect(plan.headers.has("transfer-encoding")).toBe(false);
  });

  it("does not reuse a switched protocol and frames failed CONNECT normally", () => {
    expect(resolveResponsePlan("GET", "1.1", false, 101, new Map()).reusable).toBe(false);
    expect(
      resolveResponsePlan("CONNECT", "1.1", true, 501, new Map([["content-length", "3"]])),
    ).toMatchObject({ mode: "fixed", contentLength: 3 });
  });

  it("rejects unsupported successful CONNECT before touching the socket", async () => {
    const socket = { write: vi.fn() } as unknown as Socket;
    const sink = new Http1ResponseSink(
      socket,
      "CONNECT",
      "1.1",
      false,
      new AbortController().signal,
    );
    await expect(sink.commit(200, new Map())).rejects.toMatchObject({
      code: "ERR_HTTP_CONNECT_UNSUPPORTED",
    });
    expect(socket.write).not.toHaveBeenCalled();
  });
});

let app: Nova | undefined;
const clients: Socket[] = [];
async function connect() {
  if (!app) throw new Error("Missing app");
  await app.listen(0, "127.0.0.1");
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  const socket = new Socket();
  clients.push(socket);
  const chunks: Buffer[] = [];
  socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  socket.setNoDelay(true);
  socket.connect(address.port, "127.0.0.1");
  await once(socket, "connect");
  return { socket, output: () => Buffer.concat(chunks).toString("latin1") };
}
async function finish(socket: Socket, payload: string) {
  const ended = once(socket, "end");
  socket.write(payload, "latin1");
  await ended;
}
afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  if (app) await app.close();
  app = undefined;
});
const chunkHead = "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n";

describe("HTTP/1 correctness on TCP", () => {
  it("ignores HTTP/1.0 Expect without invoking checkContinue or sending interim bytes", async () => {
    const checkContinue = vi.fn(() => ({ status: 417, message: "denied" }));
    app = createApp({ checkContinue });
    app.post("/", async (req: NovaRequest, res: NovaResponse) => {
      res.send(await req.text());
    });
    const client = await connect();
    await finish(
      client.socket,
      "POST / HTTP/1.0\r\nExpect: 100-continue\r\nContent-Length: 2\r\n\r\nok",
    );
    expect(checkContinue).not.toHaveBeenCalled();
    expect(client.output()).toContain("HTTP/1.0 200 OK");
    expect(client.output()).not.toContain("100 Continue");
    expect(client.output()).toContain("ok");
  });

  it.each(["1.0", "1.1"])("reuses HTTP/%s after declining Upgrade", async (version) => {
    app = createApp();
    app.get("/", (req: NovaRequest, res: NovaResponse) => {
      res.send(req.connection.upgrade ?? "ordinary");
    });
    const client = await connect();
    await finish(
      client.socket,
      `GET / HTTP/${version}\r\nHost: a\r\nConnection: keep-alive, upgrade\r\nUpgrade: websocket\r\n\r\nGET / HTTP/${version}\r\nHost: a\r\nConnection: close\r\n\r\n`,
    );
    expect(client.output().match(/200 OK/g)).toHaveLength(2);
    expect(client.output()).toContain("ordinary");
  });

  it("rejects CONNECT before application dispatch and Continue", async () => {
    const handler = vi.fn();
    const checkContinue = vi.fn(() => true as const);
    app = createApp({ checkContinue });
    app.use(handler);
    const client = await connect();
    await finish(
      client.socket,
      "CONNECT target:443 HTTP/1.1\r\nHost: different\r\nExpect: 100-continue\r\nContent-Length: 2\r\n\r\nokGET / HTTP/1.1\r\nHost: a\r\n\r\n",
    );
    expect(client.output()).toContain("501 Not Implemented");
    expect(client.output()).not.toContain("100 Continue");
    expect(client.output()).not.toContain("transfer-encoding");
    expect(handler).not.toHaveBeenCalled();
    expect(checkContinue).not.toHaveBeenCalled();
  });

  it("preserves effective authority in a mounted request view", async () => {
    app = createApp();
    const child = createApp();
    child.get("/", (req: NovaRequest, res: NovaResponse) => {
      res.json({
        authority: req.authority,
        host: req.getHeader("host"),
        path: req.path,
        raw: req.rawTarget,
      });
    });
    app.use("/child", child);
    const client = await connect();
    await finish(
      client.socket,
      "GET http://target:8080/child/ HTTP/1.1\r\nHost: other\r\nConnection: close\r\n\r\n",
    );
    expect(client.output()).toContain('"authority":"target:8080"');
    expect(client.output()).toContain('"host":"other"');
    expect(client.output()).toContain('"path":"/"');
    expect(client.output()).toContain('"raw":"http://target:8080/child/"');
  });

  it("accepts quoted extensions and trailers one byte at a time", async () => {
    app = createApp();
    app.post("/", async (req: NovaRequest, res: NovaResponse) => {
      const text = await req.text();
      res.send(text + req.trailers.get("x-check"));
    });
    const client = await connect();
    client.socket.write(chunkHead + "Connection: close\r\n\r\n");
    const ended = once(client.socket, "end");
    for (const byte of Buffer.from(
      '1 ; flag; name="a,b;\\\"\t\xff"\r\nx\r\n0;done\r\nX-Check: yes\r\n\r\n',
      "latin1",
    )) {
      client.socket.write(Buffer.from([byte]));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await ended;
    expect(client.output()).toContain("200 OK");
    expect(client.output()).toContain("xyes");
  });

  it.each([21, 20])("counts fragmented extensions and trailers exactly at %s", async (limit) => {
    app = createApp({ parserLimits: { maxChunkMetadataBytes: limit } });
    app.post("/", async (req: NovaRequest, res: NovaResponse) => {
      const text = await req.text();
      res.send(text + req.trailers.get("x"));
    });
    const client = await connect();
    client.socket.write(chunkHead + "Connection: close\r\n\r\n");
    const ended = once(client.socket, "end");
    for (const byte of Buffer.from("1;x=ok\r\nz\r\n0\r\nX: y\r\n\r\n")) {
      client.socket.write(Buffer.from([byte]));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await ended;
    expect(client.output()).toContain(limit === 21 ? "200 OK" : "413 Payload Too Large");
    if (limit === 21) expect(client.output()).toContain("zy");
  });

  it.each([10, 9])("counts chunk delimiters and terminal CRLF against limit %s", async (limit) => {
    app = createApp({ parserLimits: { maxChunkMetadataBytes: limit } });
    app.post("/", async (req: NovaRequest, res: NovaResponse) => {
      res.send(await req.text());
    });
    const client = await connect();
    await finish(client.socket, chunkHead + "Connection: close\r\n\r\n1\r\nx\r\n0\r\n\r\n");
    expect(client.output()).toContain(limit === 10 ? "200 OK" : "413 Payload Too Large");
  });

  it.each([8, 7])("keeps the chunk line limit independent of CRLF at %s", async (limit) => {
    app = createApp({ parserLimits: { maxChunkLineBytes: limit } });
    app.post("/", async (req: NovaRequest, res: NovaResponse) => {
      res.send(await req.text());
    });
    const client = await connect();
    await finish(client.socket, chunkHead + "Connection: close\r\n\r\n1;name=x\r\nx\r\n0\r\n\r\n");
    expect(client.output()).toContain(limit === 8 ? "200 OK" : "400 Bad Request");
  });

  it("limits cumulative metadata with default settings even for tiny chunks", async () => {
    app = createApp();
    app.post("/", async (req: NovaRequest, res: NovaResponse) => {
      res.send(await req.text());
    });
    const client = await connect();
    await finish(
      client.socket,
      chunkHead + "Connection: close\r\n\r\n" + "1\r\nx\r\n".repeat(13107) + "0\r\n\r\n",
    );
    expect(client.output()).toContain("413 Payload Too Large");
  });

  it.each(["1;long=value", "0\r\nX: abcdefghi"])(
    "rejects partial metadata before waiting for CRLF: %s",
    async (body) => {
      app = createApp({ parserLimits: { maxChunkMetadataBytes: 8 } });
      app.post("/", async (req: NovaRequest, res: NovaResponse) => {
        res.send(await req.text());
      });
      const client = await connect();
      await finish(client.socket, chunkHead + "\r\n" + body);
      expect(client.output()).toContain("413 Payload Too Large");
    },
  );

  it("resets metadata budget for a pipelined request", async () => {
    app = createApp({ parserLimits: { maxChunkMetadataBytes: 10 } });
    app.post("/", async (req: NovaRequest, res: NovaResponse) => {
      res.send(await req.text());
    });
    const client = await connect();
    await finish(
      client.socket,
      chunkHead +
        "\r\n1\r\nx\r\n0\r\n\r\n" +
        chunkHead +
        "Connection: close\r\n\r\n1\r\ny\r\n0\r\n\r\n",
    );
    expect(client.output().match(/200 OK/g)).toHaveLength(2);
  });

  it.each([
    ["1;broken=\r\nx\r\n0\r\n\r\n", 65536, 400],
    ["1;a=b\r\nx\r\n1;a=b\r\ny\r\n0\r\n\r\n", 20, 413],
    ["0\r\nX: abcdefgh\r\n\r\n", 10, 413],
  ])(
    "rejects invalid or excessive metadata and closes before pipeline: %s",
    async (body, limit, status) => {
      const next = vi.fn();
      app = createApp({ parserLimits: { maxChunkMetadataBytes: limit } });
      app.post("/", async (req: NovaRequest, res: NovaResponse) => {
        res.send(await req.text());
      });
      app.get("/next", next);
      const client = await connect();
      await finish(
        client.socket,
        chunkHead + "\r\n" + body + "GET /next HTTP/1.1\r\nHost: a\r\n\r\n",
      );
      expect(client.output()).toContain(`HTTP/1.1 ${status}`);
      expect(next).not.toHaveBeenCalled();
    },
  );
});
