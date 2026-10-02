/**
 * Nova 脚本共享工具
 *
 * 提供发布、打包和检查脚本之间复用的基础能力
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 仓库根目录，不依赖执行命令时的工作目录
export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 读取指定路径的 JSON 文件
export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// 使用当前 Node.js 执行命令
export function runNode(args, options) {
  return execFileSync(process.execPath, args, options);
}

// 跨平台执行 npm 命令
export function runNpm(args, options) {
  if (process.platform === "win32") {
    // pnpm 也会设置 npm_execpath，仅在它确实指向 npm 时复用
    const npmCli =
      path.basename(process.env.npm_execpath ?? "") === "npm-cli.js"
        ? process.env.npm_execpath
        : path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");

    // 使用当前 Node.js 执行 npm CLI，避免依赖 npm.cmd
    return runNode([npmCli, ...args], options);
  }

  // Unix 平台直接使用 PATH 中的 npm
  return execFileSync("npm", args, options);
}
