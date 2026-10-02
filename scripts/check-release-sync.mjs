/**
 * Nova 发布配置一致性检查
 *
 * 用于验证 nova-http 与 create-nova-http 的发布版本、Node.js 要求和打包配置是否保持同步
 *
 * 执行命令：npm run check:release
 *
 * 主要步骤：
 * 1. 检查工作区与发布包的 Node.js 版本约束
 * 2. 检查两个发布包的版本与 Changesets 固定版本组
 * 3. 检查所有项目模板的 Node.js 运行时与类型版本
 * 4. 检查 create-nova-http 的必要发布文件
 *
 * 该检查只验证发布相关配置的一致性，不执行构建、打包或安装
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readJson, rootDir } from "./shared.mjs";

// 发布与开发环境的版本约束
const developmentNodeRange = "^22.22.1 || ^24.0.0";
const runtimeNodeRange = ">=20.0.0";
const nodeTypesRange = "^20.0.0";

// 需要保持一致的项目模板
const templates = ["minimal", "minimal-js", "api", "api-js"];

// create-nova-http 必须包含的发布文件
const requiredInitializerFiles = ["README.md", "LICENSE", "CHANGELOG.md"];

const rootPackage = readJson(path.join(rootDir, "package.json"));
const frameworkPackage = readJson(path.join(rootDir, "packages/nova-http/package.json"));
const initializerPackage = readJson(path.join(rootDir, "packages/create-nova-http/package.json"));
const changesetsConfig = readJson(path.join(rootDir, ".changeset/config.json"));

// 1. 检查仓库开发环境与发布运行时的 Node.js 版本约束
assert.equal(
  rootPackage.engines.node,
  developmentNodeRange,
  "Root package must use the expected development Node.js range",
);

assert.equal(
  frameworkPackage.engines.node,
  runtimeNodeRange,
  "nova-http must use the published runtime Node.js range",
);

assert.equal(
  initializerPackage.engines.node,
  runtimeNodeRange,
  "create-nova-http must use the published runtime Node.js range",
);

// 2. 检查两个发布包是否保持相同版本并由 Changesets 一起发布
assert.equal(
  initializerPackage.version,
  frameworkPackage.version,
  `Package versions must match: nova-http=${frameworkPackage.version}, create-nova-http=${initializerPackage.version}`,
);

const fixedTogether = changesetsConfig.fixed.some(
  (group) => group.includes("nova-http") && group.includes("create-nova-http"),
);

assert.ok(
  fixedTogether,
  "nova-http and create-nova-http must belong to one fixed Changesets group",
);

// 3. 检查所有模板是否使用统一的运行时与 Node.js 类型基线
for (const template of templates) {
  const templatePackage = readJson(
    path.join(rootDir, `packages/nova-http/cli/templates/${template}/package.json`),
  );

  assert.equal(
    templatePackage.engines.node,
    runtimeNodeRange,
    `${template} template must use the published runtime Node.js range`,
  );

  if (templatePackage.devDependencies?.["@types/node"]) {
    assert.equal(
      templatePackage.devDependencies["@types/node"],
      nodeTypesRange,
      `${template} template must use the runtime baseline Node.js types`,
    );
  }
}

// 4. 检查 create-nova-http 发布包是否包含必要文件
for (const fileName of requiredInitializerFiles) {
  assert.ok(
    fs.existsSync(path.join(rootDir, "packages/create-nova-http", fileName)),
    `create-nova-http is missing ${fileName}`,
  );

  assert.ok(
    initializerPackage.files.includes(fileName),
    `create-nova-http package files must include ${fileName}`,
  );
}

console.log(`Release packages are synchronized at ${frameworkPackage.version}.`);
