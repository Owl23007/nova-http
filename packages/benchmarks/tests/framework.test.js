import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("未安装框架产物时允许导入，仅在加载默认运行时才报错", async () => {
  // 隔离目录没有 nova-http 依赖，避免已有构建产物掩盖提前加载问题
  const directory = await mkdtemp(join(tmpdir(), "nova-framework-"));
  const entry = join(directory, "framework.mjs");
  try {
    await copyFile(
      new URL("../suites/production/src/app/core/framework.js", import.meta.url),
      entry,
    );
    const script = `
      const { loadNovaHttp } = await import(${JSON.stringify(pathToFileURL(entry).href)});
      console.log("imported");
      try { loadNovaHttp(); process.exitCode = 1; }
      catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("imported");
    expect(result.stderr).toContain('Run "pnpm -F nova-http run build" first.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
