import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

export async function historicalState(root) {
  const completed = [];
  const archive = path.join(root, ".benchmark/http-v1");
  for (const directory of await fs.readdir(archive).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    const manifest = JSON.parse(
      await fs.readFile(path.join(archive, directory, "manifest.json"), "utf8"),
    );
    if (manifest.kind === "historical-initialization" && manifest.status === "success")
      completed.push(`${manifest.suite}/${manifest.scenario}/${manifest.profile}`);
  }
  return [...new Set(completed)];
}

export async function prepareHistorical(root) {
  const manifest = JSON.parse(
    await fs.readFile(new URL("../config/historical.json", import.meta.url), "utf8"),
  );
  const response = await fetch("https://registry.npmjs.org/nova-http", {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("无法核实历史 registry");
  const registry = await response.json();
  const targets = [];
  for (const item of manifest.targets) {
    const published = registry.versions[item.version];
    if (
      published?.dist.integrity !== item.integrity ||
      published.dist.tarball !== item.tarball ||
      registry.time[item.version] !== item.publishedAt
    )
      throw new Error(`历史发布元数据发生变化: ${item.version}`);
    if (published.dependencies && Object.keys(published.dependencies).length)
      throw new Error("历史包包含未锁定依赖");
    const tarball = await fetch(item.tarball, { signal: AbortSignal.timeout(30000) });
    if (!tarball.ok) throw new Error("历史包下载失败");
    const data = Buffer.from(await tarball.arrayBuffer());
    if (`sha512-${createHash("sha512").update(data).digest("base64")}` !== item.integrity)
      throw new Error("历史包 integrity 不匹配");
    const work = await fs.mkdtemp(path.join(await ensureWork(root), `nova-${item.version}-`));
    const tar = path.join(work, "package.tgz");
    await fs.writeFile(tar, data);
    await fs.writeFile(path.join(work, "package.json"), JSON.stringify({ private: true }));
    const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    execFileSync(
      process.execPath,
      [
        npmCli,
        "install",
        "--prefix",
        work,
        "--ignore-scripts",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
        tar,
      ],
      { stdio: "inherit", timeout: 120000 },
    );
    const require = createRequire(path.join(work, "package.json"));
    targets.push({
      ...item,
      id: `nova-${item.version.replaceAll(".", "-")}`,
      package: "nova-http",
      source: "npm",
      adapter: "nova",
      entry: require.resolve("nova-http"),
      sha: null,
      shaUnavailableReason: "npm tarball 不以标签 SHA 证明源码身份",
      bodyAPI: "legacy",
    });
  }
  return { manifest, targets };
}

async function ensureWork(root) {
  const work = path.join(root, ".tmp/benchmark/work");
  await fs.mkdir(work, { recursive: true });
  return work;
}
