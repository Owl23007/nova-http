import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNpmCli } from "../runner/historical.js";

const temporary = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => fs.rm(root, { recursive: true })));
});

async function fixture(relative) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nova-benchmark-npm-"));
  temporary.push(root);
  const execPath = path.join(root, "bin", process.platform === "win32" ? "node.exe" : "node");
  const npmCli = path.join(root, ...relative);
  await fs.mkdir(path.dirname(npmCli), { recursive: true });
  await fs.writeFile(npmCli, "");
  return { execPath, npmCli };
}

describe("resolveNpmCli", () => {
  it("resolves the GitHub runner lib layout", async () => {
    const { execPath, npmCli } = await fixture(["lib", "node_modules", "npm", "bin", "npm-cli.js"]);

    await expect(resolveNpmCli(execPath)).resolves.toBe(npmCli);
  });

  it("resolves the Windows-style adjacent layout", async () => {
    const { execPath, npmCli } = await fixture(["bin", "node_modules", "npm", "bin", "npm-cli.js"]);

    await expect(resolveNpmCli(execPath)).resolves.toBe(npmCli);
  });
});
