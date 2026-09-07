const fs = require("fs");
const path = require("path");

/**
 * 为 create-nova-http 包准备 dist 文件夹
 *
 * 1. 确保 nova-http 包已经构建完成
 * 2. 将 nova-http/dist/cli 下的文件复制到 create-nova-http/dist/cli 下
 * 3. 将 nova-http/dist/cli/templates 下的模板文件复制到 create-nova-http/dist/cli/templates 下
 *
 * create-nova-http 包只作为一个 CLI 工具，用于创建 nova-http 项目
 */

/** 源 CLI 目录的路径 */
const sourceCliDir = path.resolve(__dirname, "..", "..", "nova-http", "dist", "cli");
/** 目标 CLI 目录的路径 */
const targetCliDir = path.join(__dirname, "..", "dist", "cli");

// 1. 确保 nova-http 包已经构建完成
if (!fs.existsSync(sourceCliDir)) {
  console.error(`Missing ${sourceCliDir}. Run "pnpm -F nova-http run build" first.`);
  process.exit(1);
}

// 2. 移除上次构建的 create-nova-http/dist/cli 目录，并重新创建空目录
// recursive: true 递归目录及其内容，force: true 即使目录不存在也不会报错
fs.rmSync(targetCliDir, { recursive: true, force: true });
fs.mkdirSync(targetCliDir, { recursive: true });

// 3. 将 nova-http/dist/cli/templates 下的模板文件复制到 create-nova-http/dist/cli/templates 下
const filesToCopy = ["create-nova.js", "create-nova.js.map", "shared.js", "shared.js.map"];

for (const fileName of filesToCopy) {
  fs.copyFileSync(path.join(sourceCliDir, fileName), path.join(targetCliDir, fileName));
}

// 4. 复制模板文件夹
const sourceTemplatesDir = path.join(sourceCliDir, "templates");
const targetTemplatesDir = path.join(targetCliDir, "templates");
fs.cpSync(sourceTemplatesDir, targetTemplatesDir, { recursive: true });

console.log("Prepared dist files for create-nova-http package.");
