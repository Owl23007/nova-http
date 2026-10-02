/**
 * Nova CLI 生成一致性检查
 *
 * 用于验证 nova-http 与 create-nova-http 的 CLI 和模板生成结果是否保持同步
 *
 * 执行命令：npm run check:cli
 *
 * 主要步骤：
 * 1. 准备 CLI 分发文件并检查版本号
 * 2. 生成所有模板与语言组合并检查生成结果
 * 3. 检查 nova create 入口是否与 create-nova-http 保持一致
 *
 * 该检查只验证项目初始化结果，不执行 npm install 或运行生成项目
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, rootDir, runNode } from "./shared.mjs";

const frameworkPackage = readJson(path.join(rootDir, "packages/nova-http/package.json"));
const initializerPackage = readJson(path.join(rootDir, "packages/create-nova-http/package.json"));

// 1. 准备 create-nova-http 的发布目录，确保检查实际分发内容
runNode([path.join(rootDir, "packages/create-nova-http/scripts/prepare-dist.cjs")]);

const initializerCli = path.join(rootDir, "packages/create-nova-http/dist/cli/create-nova.js");
const frameworkCli = path.join(rootDir, "packages/nova-http/dist/cli/nova.js");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-cli-check-"));

// 使用当前 Node.js 执行指定 CLI，并返回标准输出
function runCli(cliPath, args) {
  return runNode([cliPath, ...args], {
    cwd: tempDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// 递归检查模板生成结果，确保没有残留 {{ placeholder }}
function assertNoTemplatePlaceholders(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      assertNoTemplatePlaceholders(entryPath);
      continue;
    }

    const content = fs.readFileSync(entryPath, "utf8");
    assert.doesNotMatch(content, /\{\{[^}]+\}\}/, `Unresolved placeholder in ${entryPath}`);
  }
}

try {
  // 1. 检查两个 CLI 暴露的版本号
  assert.equal(
    runCli(initializerCli, ["--version"]).trim(),
    initializerPackage.version,
    "Initializer CLI reports the wrong version",
  );

  assert.equal(
    runCli(frameworkCli, ["--version"]).trim(),
    frameworkPackage.version,
    "Framework CLI reports the wrong version",
  );

  // 2. 覆盖所有内置模板与语言组合
  for (const template of ["minimal", "api"]) {
    for (const language of ["ts", "js"]) {
      const projectName = `${template}-${language}`;

      runCli(initializerCli, [projectName, "--template", template, "--lang", language]);

      const projectDir = path.join(tempDir, projectName);
      const generatedPackage = readJson(path.join(projectDir, "package.json"));

      assert.equal(generatedPackage.name, projectName);
      assert.equal(generatedPackage.dependencies["nova-http"], `^${frameworkPackage.version}`);
      assertNoTemplatePlaceholders(projectDir);

      // JavaScript 模板额外执行 Node.js 语法检查
      if (language === "js") {
        for (const fileName of findFiles(projectDir, ".js")) {
          runNode(["--check", fileName], {
            stdio: "pipe",
          });
        }
      }
    }
  }

  // 3. 检查 nova create 是否复用相同的初始化逻辑与框架版本
  runCli(frameworkCli, ["create", "framework-entry", "--template", "minimal", "--lang", "js"]);

  assert.equal(
    readJson(path.join(tempDir, "framework-entry/package.json")).dependencies["nova-http"],
    `^${frameworkPackage.version}`,
  );

  console.log(`CLI generation is synchronized with nova-http ${frameworkPackage.version}.`);
} finally {
  // 无论检查成功还是失败都清理临时目录
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// 递归收集指定扩展名的文件
function findFiles(directory, extension) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...findFiles(entryPath, extension));
    } else if (path.extname(entry.name) === extension) {
      files.push(entryPath);
    }
  }

  return files;
}
