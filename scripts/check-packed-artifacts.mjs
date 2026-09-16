import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const artifactsDir = path.resolve(process.argv[2] ?? ".artifacts");
const artifacts = fs.readdirSync(artifactsDir).filter((name) => name.endsWith(".tgz"));
const frameworkTarball = findArtifact("nova-http-");
const initializerTarball = findArtifact("create-nova-http-");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-artifact-check-"));

function findArtifact(prefix) {
  const matches = artifacts.filter((name) => name.startsWith(prefix));
  assert.equal(matches.length, 1, `Expected one ${prefix}*.tgz artifact, found ${matches.length}`);
  return path.join(artifactsDir, matches[0]);
}

function request(port) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/health" }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode, body }));
      })
      .on("error", reject);
  });
}

function installArtifacts() {
  const args = [
    "install",
    "--engine-strict",
    "--ignore-scripts",
    "--no-package-lock",
    frameworkTarball,
    initializerTarball,
  ];
  const options = { cwd: tempDir, stdio: "inherit" };
  if (process.platform === "win32") {
    const npmCli =
      process.env.npm_execpath ??
      path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    execFileSync(process.execPath, [npmCli, ...args], options);
    return;
  }
  execFileSync("npm", args, options);
}

try {
  fs.writeFileSync(
    path.join(tempDir, "package.json"),
    JSON.stringify({ name: "nova-artifact-check", private: true }),
  );
  installArtifacts();

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
  assert.deepEqual(await request(address.port), { statusCode: 200, body: '{"ok":true}' });
  await app.close();

  const cli = path.join(tempDir, "node_modules/create-nova-http/dist/cli/create-nova.js");
  execFileSync(process.execPath, [cli, "smoke-app", "--template", "minimal", "--lang", "js"], {
    cwd: tempDir,
    stdio: "inherit",
  });
  const generatedPackage = JSON.parse(
    fs.readFileSync(path.join(tempDir, "smoke-app/package.json"), "utf8"),
  );
  assert.equal(generatedPackage.engines.node, ">=20.0.0");
  assert.equal(generatedPackage.dependencies["nova-http"], `^${frameworkPackage.version}`);

  console.log(`Packed artifacts passed on ${process.version}.`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
