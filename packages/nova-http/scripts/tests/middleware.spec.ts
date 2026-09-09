import { once } from "events";
import { Socket } from "net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createApp,
  type Nova,
  type NovaRequest,
  type NovaResponse,
  type NextFunction,
} from "../../src";

let app: Nova | undefined;

async function listen(testApp: Nova): Promise<number> {
  await testApp.listen(0, "127.0.0.1");
  const address = testApp.address();
  if (address === null || typeof address === "string") throw new Error("Missing TCP address");
  return address.port;
}

async function request(port: number, path: string): Promise<string> {
  const socket = new Socket();
  const chunks: Buffer[] = [];

  socket.connect(port, "127.0.0.1");
  await once(socket, "connect");
  socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
  await once(socket, "end");

  return Buffer.concat(chunks).toString("utf8");
}

describe("Middleware", () => {
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("UT-MW-01 全局中间件先于路由执行", async () => {
    app = createApp();
    const calls: string[] = [];

    app.use((_req: NovaRequest, _res: NovaResponse, next: NextFunction) => {
      calls.push("middleware");
      next();
    });
    app.get("/hello", (_req: NovaRequest, res: NovaResponse) => {
      calls.push("route");
      res.send("hello");
    });

    const port = await listen(app);
    const response = await request(port, "/hello");

    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("hello");
    expect(calls).toEqual(["middleware", "route"]);
  });

  it("UT-MW-02 路径前缀中间件仅在前缀匹配时执行", async () => {
    app = createApp();
    const calls: string[] = [];

    app.use("/api", (_req: NovaRequest, _res: NovaResponse, next: NextFunction) => {
      calls.push("api-middleware");
      next();
    });
    app.get("/api/users", (_req: NovaRequest, res: NovaResponse) => {
      res.send("api users");
    });
    app.get("/public", (_req: NovaRequest, res: NovaResponse) => {
      res.send("public");
    });

    const port = await listen(app);
    const apiResponse = await request(port, "/api/users");
    const publicResponse = await request(port, "/public");

    expect(apiResponse).toContain("api users");
    expect(publicResponse).toContain("public");
    expect(calls).toEqual(["api-middleware"]);
  });

  it("UT-MW-03 中间件提前发送响应时不再执行后续路由", async () => {
    app = createApp();
    let routeCalled = false;

    app.use((_req: NovaRequest, res: NovaResponse) => {
      res.send("blocked");
    });
    app.get("/hello", (_req: NovaRequest, res: NovaResponse) => {
      routeCalled = true;
      res.send("hello");
    });

    const port = await listen(app);
    const response = await request(port, "/hello");

    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("blocked");
    expect(response).not.toContain("hello");
    expect(routeCalled).toBe(false);
  });

  it("UT-MW-04 中间件抛出异常时进入错误处理流程", async () => {
    app = createApp();
    const calls: string[] = [];

    app.use(() => {
      calls.push("middleware");
      throw new Error("test error");
    });
    app.use((err: unknown, _req: NovaRequest, res: NovaResponse, _next: NextFunction) => {
      calls.push("error-middleware");
      res.status(500).send(err instanceof Error ? err.message : "unknown error");
    });
    app.get("/hello", (_req: NovaRequest, res: NovaResponse) => {
      calls.push("route");
      res.send("hello");
    });

    const port = await listen(app);
    const response = await request(port, "/hello");

    expect(response).toContain("HTTP/1.1 500 Internal Server Error");
    expect(response).toContain("test error");
    expect(calls).toEqual(["middleware", "error-middleware"]);
  });

  it("emits onNotFound only after the default 404 response is determined", async () => {
    app = createApp();
    let hookError: unknown;

    app.addHook("onError", ({ error }) => {
      hookError = error;
    });
    app.addHook("onNotFound", ({ res }) => {
      res.status(200).send("overridden");
    });

    const port = await listen(app);
    const response = await request(port, "/missing");

    expect(response).toContain("HTTP/1.1 404 Not Found");
    expect(response).toContain("\r\n\r\nNot Found");
    expect(response).not.toContain("overridden");
    expect(hookError).toBeInstanceOf(Error);
  });

  it("precompiles route middleware without accumulating handlers between requests", async () => {
    app = createApp();
    const calls: string[] = [];

    app.get(
      "/compiled",
      (_req, _res, next) => {
        calls.push("first");
        next();
      },
      (_req, _res, next) => {
        calls.push("second");
        next();
      },
      (_req: NovaRequest, res: NovaResponse) => {
        calls.push("terminal");
        res.send("ok");
      },
    );

    const port = await listen(app);
    await request(port, "/compiled");
    await request(port, "/compiled");

    expect(calls).toEqual(["first", "second", "terminal", "first", "second", "terminal"]);
  });
});
