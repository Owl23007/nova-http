import { once } from "events";
import { mkdtemp, rm } from "fs/promises";
import { Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { bodyParser, createApp, type Nova } from "../../src";

type PerformanceApp = {
  app: Nova;
  close: () => Promise<void>;
};

let performanceApp: PerformanceApp | undefined;
let tempDir: string | undefined;

async function createTestApp(): Promise<PerformanceApp> {
  // 测试运行在当前 tsconfig 下，使用 file URL 动态导入。
  const modulePath = pathToFileURL(join(__dirname, "../performance/src/app/create-app.js")).href;
  const { createProductionApp } = await import(modulePath);

  // 每个用例使用独立 SQLite 文件，避免订单数据在测试间串扰。
  tempDir = await mkdtemp(join(tmpdir(), "nova-performance-"));

  return createProductionApp(
    {
      PROD_API_HOST: "127.0.0.1",
      PROD_API_PORT: "0",
      PROD_API_METRICS_TOKEN: "test-token",
      PROD_API_SQLITE_PATH: join(tempDir, "performance-test.sqlite"),
      PROD_API_REDIS_HOST: "127.0.0.1",
      PROD_API_REDIS_PORT: "6379",
      // Redis 使用真实 6379 实例，通过唯一前缀隔离测试 key。
      PROD_API_REDIS_KEY_PREFIX: `nova-http:test:${Date.now()}:${Math.random()}`,
    },
    { createApp, bodyParser },
  ) as Promise<PerformanceApp>;
}

async function listen(app: Nova): Promise<number> {
  await app.listen(0, "127.0.0.1");
  // 测试端口使用 0 自动分配，需要读取底层 server 的实际端口。
  const address = (app as any)["_server"].address();
  return address.port;
}

async function request(port: number, raw: string): Promise<string> {
  // 直接走 TCP 原始 HTTP 文本，覆盖 Nova 自身解析、路由和响应写回链路。
  const socket = new Socket();
  const chunks: Buffer[] = [];

  socket.connect(port, "127.0.0.1");
  await once(socket, "connect");
  socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  socket.write(raw);
  await once(socket, "end");

  return Buffer.concat(chunks).toString("utf8");
}

describe("performance ESM suite", () => {
  afterEach(async () => {
    // 关闭服务并删除临时 SQLite 文件；Redis key 通过唯一前缀自然隔离并受 TTL 清理。
    await performanceApp?.close();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    performanceApp = undefined;
    tempDir = undefined;
  });

  it("mounts user subapp and serves cached reads through the redis middleware", async () => {
    performanceApp = await createTestApp();
    const port = await listen(performanceApp.app);

    // 首次请求回源 SQLite 并写入 Redis，后续同 key 请求应命中缓存。
    const first = await request(
      port,
      "GET /api/users/42 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(first).toContain("HTTP/1.1 200 OK");
    expect(first).toContain("x-cache: MISS");
    expect(first).toContain('"id":"42"');

    const second = await request(
      port,
      "GET /api/users/42 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(second).toContain("HTTP/1.1 200 OK");
    expect(second).toContain("x-cache: HIT");
  });

  it("persists orders through the sqlite repository mounted under the orders subapp", async () => {
    performanceApp = await createTestApp();
    const port = await listen(performanceApp.app);
    const body = JSON.stringify({
      customerId: "cust-test",
      items: [{ sku: "sku-1", quantity: 1 }],
    });

    // 创建订单验证 bodyParser、业务校验、subapp 挂载和 SQLite 写入。
    const created = await request(
      port,
      [
        "POST /api/orders HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "",
        body,
      ].join("\r\n"),
    );
    expect(created).toContain("HTTP/1.1 201 Created");
    expect(created).toContain('"customerId":"cust-test"');

    // 统计接口读取同一个 SQLite 仓储，确认写入已经落库。
    const stats = await request(
      port,
      "GET /api/orders/stats HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(stats).toContain("HTTP/1.1 200 OK");
    expect(stats).toContain('"total":1');
  });

  it("hides metrics without a token and returns a snapshot with the benchmark token", async () => {
    performanceApp = await createTestApp();
    const port = await listen(performanceApp.app);

    // 指标接口未授权时伪装成 404，避免暴露内部观测面。
    const hidden = await request(
      port,
      "GET /__metrics HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect(hidden).toContain("HTTP/1.1 404 Not Found");

    // 携带压测 token 时返回资源采样所需的 memory 和 eventLoop 指标。
    const visible = await request(
      port,
      [
        "GET /__metrics HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "x-benchmark-token: test-token",
        "",
        "",
      ].join("\r\n"),
    );
    expect(visible).toContain("HTTP/1.1 200 OK");
    expect(visible).toContain('"memory"');
    expect(visible).toContain('"eventLoop"');
  });
});
