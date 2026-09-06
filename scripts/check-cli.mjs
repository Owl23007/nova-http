import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frameworkPackage = readJson(path.join(rootDir, "packages/nova-http/package.json"));
const initializerPackage = readJson(path.join(rootDir, "packages/create-nova-http/package.json"));
execFileSync(process.execPath, [
  path.join(rootDir, "packages/create-nova-http/scripts/prepare-dist.cjs"),
]);
const initializerCli = path.join(rootDir, "packages/create-nova-http/dist/cli/create-nova.js");
const frameworkCli = path.join(rootDir, "packages/nova-http/dist/cli/nova.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-cli-check-"));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runCli(cliPath, args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: tempDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

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

  for (const template of ["minimal", "api"]) {
    for (const language of ["ts", "js"]) {
      const projectName = `${template}-${language}`;
      runCli(initializerCli, [projectName, "--template", template, "--lang", language]);

      const projectDir = path.join(tempDir, projectName);
      const generatedPackage = readJson(path.join(projectDir, "package.json"));
      assert.equal(generatedPackage.name, projectName);
      assert.equal(generatedPackage.dependencies["nova-http"], `^${frameworkPackage.version}`);
      assertNoTemplatePlaceholders(projectDir);

      if (language === "js") {
        for (const fileName of findFiles(projectDir, ".js")) {
          execFileSync(process.execPath, ["--check", fileName], { stdio: "pipe" });
        }
      }
    }
  }

  runCli(frameworkCli, ["create", "framework-entry", "--template", "minimal", "--lang", "js"]);
  assert.equal(
    readJson(path.join(tempDir, "framework-entry/package.json")).dependencies["nova-http"],
    `^${frameworkPackage.version}`,
  );

  console.log(`CLI generation is synchronized with nova-http ${frameworkPackage.version}.`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

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
