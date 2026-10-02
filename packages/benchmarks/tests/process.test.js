import { it, expect } from "vitest";
import { startTarget } from "../runner/process.js";
import { measure } from "../suites/http/driver.js";
import { scenarios } from "../suites/http/scenarios.js";
import { profiles } from "../config/profiles.js";

it("启动超时会终止进程", async () => {
  await expect(
    startTarget({}, "text", {
      timeout: 100,
      server: new URL("./fixtures/hang.js", import.meta.url),
    }),
  ).rejects.toThrow("超时");
});
it("报告服务提前退出", async () => {
  await expect(
    startTarget({}, "text", { server: new URL("./fixtures/exit.js", import.meta.url) }),
  ).rejects.toThrow("提前退出");
});
it("启动期间接受取消", async () => {
  const controller = new AbortController();
  const promise = startTarget({}, "text", {
    signal: controller.signal,
    server: new URL("./fixtures/hang.js", import.meta.url),
  });
  controller.abort();
  await expect(promise).rejects.toThrow("取消");
});
it("测量期间服务退出不产生成绩", async () => {
  const server = await startTarget({ adapter: "node" }, "text");
  try {
    const promise = measure(server.port, scenarios.text, profiles.smoke, 10, {
      child: server.child,
    });
    const assertion = expect(promise).rejects.toThrow("服务退出");
    await server.stop();
    await assertion;
  } finally {
    await server.stop();
  }
});
