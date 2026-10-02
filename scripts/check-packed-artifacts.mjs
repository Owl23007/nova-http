/**
 * Nova 发布产物检查
 *
 * 用于验证 nova-http 与 create-nova-http 打包后的 tgz 产物是否可以正常安装和使用
 *
 * 执行命令：npm run check:artifacts
 *
 * 主要步骤：
 * 1. 命令先构建并打包，再定位并安装 nova-http 与 create-nova-http 的打包产物
 * 2. 检查包元信息并验证 nova-http 可以正常启动和响应请求
 * 3. 使用 create-nova-http 创建项目并检查生成结果
 *
 * 该检查基于实际 npm 打包产物执行，用于验证发布前的安装与基础运行闭环
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { readJson, runNode, runNpm } from "./shared.mjs";

const artifactsDir = path.resolve(process.argv[2] ?? "artifacts");
const artifacts = fs.readdirSync(artifactsDir).filter((name) => name.endsWith(".tgz"));

const frameworkTarball = findArtifact("nova-http-");
const initializerTarball = findArtifact("create-nova-http-");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-artifact-check-"));

// 从产物目录中定位唯一匹配的 tgz 文件
function findArtifact(prefix) {
  const matches = artifacts.filter((name) => name.startsWith(prefix));

  assert.equal(matches.length, 1, `Expected one ${prefix}*.tgz artifact, found ${matches.length}`);

  return path.join(artifactsDir, matches[0]);
}

// 请求临时启动的 Nova 服务并返回状态码与响应内容
function request(port) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/health" }, (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode,
            body,
          }),
        );
      })
      .on("error", reject);
  });
}

// 将两个 tgz 产物安装到独立临时目录
function installArtifacts() {
  const args = [
    "install",
    "--engine-strict",
    "--ignore-scripts",
    "--no-package-lock",
    frameworkTarball,
    initializerTarball,
  ];

  const options = {
    cwd: tempDir,
    stdio: "inherit",
  };

  runNpm(args, options);
}

try {
  // 1. 创建临时项目并安装实际打包产物
  fs.writeFileSync(
    path.join(tempDir, "package.json"),
    JSON.stringify({
      name: "nova-artifact-check",
      private: true,
    }),
  );

  installArtifacts();

  // 2. 检查包元信息并验证 nova-http 的基础运行能力
  const require = createRequire(path.join(tempDir, "artifact-check.cjs"));

  const frameworkPackage = require("nova-http/package.json");
  const initializerPackage = require("create-nova-http/package.json");

  assert.equal(frameworkPackage.engines.node, ">=20.0.0");
  assert.equal(initializerPackage.engines.node, ">=20.0.0");

  const { createApp } = require("nova-http");

  const app = createApp();

  app.get("/health", (_request, response) => response.json({ ok: true }));

  await app.listen(0, "127.0.0.1");

  const address = app.address();

  assert.ok(address && typeof address !== "string");

  try {
    assert.deepEqual(await request(address.port), {
      statusCode: 200,
      body: '{"ok":true}',
    });
  } finally {
    await app.close();
  }

  // 3. 使用已安装的 create-nova-http 创建项目并检查生成结果
  const cli = path.join(tempDir, "node_modules/create-nova-http/dist/cli/create-nova.js");

  runNode([cli, "smoke-app", "--template", "minimal", "--lang", "js"], {
    cwd: tempDir,
    stdio: "inherit",
  });

  const generatedPackage = readJson(path.join(tempDir, "smoke-app/package.json"));

  assert.equal(generatedPackage.engines.node, ">=20.0.0");

  assert.equal(generatedPackage.dependencies["nova-http"], `^${frameworkPackage.version}`);

  console.log(`Packed artifacts passed on ${process.version}.`);
} finally {
  // 无论检查成功还是失败都清理临时目录
  fs.rmSync(tempDir, {
    recursive: true,
    force: true,
  });
}
