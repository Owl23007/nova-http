/**
 * Nova 发布产物打包
 *
 * 用于生成 nova-http 与 create-nova-http 的 npm tgz 发布产物
 * 并将当前版本产物同步到 artifacts 目录供后续检查使用
 *
 * 执行命令：npm run pack:release
 *
 * 主要步骤：
 * 1. 在临时目录中分别执行 npm pack
 * 2. 清理 artifacts 中旧的 Nova 发布产物
 * 3. 将本次生成的 tgz 复制到 artifacts 目录
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rootDir, runNpm } from "./shared.mjs";

// 只识别 Nova 两个发布包生成的 tgz 文件
const isReleaseTarball = (name) => /^(?:nova-http|create-nova-http)-.+\.tgz$/.test(name);

function packRelease() {
  const artifactsDir = path.join(rootDir, "artifacts");
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-release-pack-"));

  try {
    // 1. 在独立临时目录中生成两个 npm 发布产物
    for (const packageName of ["nova-http", "create-nova-http"]) {
      runNpm(["pack", "--pack-destination", stagingDir], {
        cwd: path.join(rootDir, "packages", packageName),
        stdio: "inherit",
      });
    }

    fs.mkdirSync(artifactsDir, {
      recursive: true,
    });

    // 2. 只清理旧的 Nova 发布产物，避免旧版本进入后续检查
    for (const name of fs.readdirSync(artifactsDir).filter(isReleaseTarball)) {
      fs.unlinkSync(path.join(artifactsDir, name));
    }

    // 3. 将本次生成的发布产物同步到 artifacts 目录
    for (const name of fs.readdirSync(stagingDir).filter(isReleaseTarball)) {
      fs.copyFileSync(path.join(stagingDir, name), path.join(artifactsDir, name));
    }

    console.log(`Release packages packed into ${artifactsDir}.`);
  } finally {
    // 无论打包成功还是失败都清理临时目录
    fs.rmSync(stagingDir, {
      recursive: true,
      force: true,
    });
  }
}

// 仅在直接执行当前脚本时打包
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packRelease();
}
