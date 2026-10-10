import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { profiles } from "../config/profiles.js";
import { scenarios } from "../suites/http/scenarios.js";
import { metadata, git } from "../report/metadata.js";
import { summary } from "../report/results.js";
import { run } from "./engine.js";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "smoke" },
    scenario: { type: "string", default: "json-small" },
    "baseline-root": { type: "string" },
    "target-root": { type: "string" },
    targets: { type: "string" },
  },
});
if (!profiles[values.profile] || !scenarios[values.scenario])
  throw new Error("未知 profile 或场景");
const build = (cwd) => {
  if (!process.env.npm_execpath)
    throw new Error("请通过 pnpm --filter @nova-http/benchmarks bench 运行");
  execFileSync(process.execPath, [process.env.npm_execpath, "--filter", "nova-http", "build"], {
    cwd,
    stdio: "inherit",
  });
};
const checkout = async (cwd, id) => {
  build(cwd);
  const packageRoot = path.join(cwd, "packages/nova-http");
  const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  return {
    id,
    adapter: "nova",
    package: pkg.name,
    version: pkg.version,
    source: "checkout",
    sha: git(cwd, "rev-parse", "HEAD"),
    dirty: git(cwd, "status", "--porcelain") !== "",
    entry: path.join(packageRoot, "dist/src/index.js"),
    baseline: id === "nova-baseline",
  };
};
let targets = [
  await checkout(
    values["target-root"] ? path.resolve(values["target-root"]) : root,
    "nova-current",
  ),
  {
    id: "fastify-schema",
    adapter: "fastify",
    schema: true,
    package: "fastify",
    version: require("fastify/package.json").version,
    source: "lockfile",
  },
  {
    id: "fastify-no-schema",
    adapter: "fastify",
    schema: false,
    package: "fastify",
    version: require("fastify/package.json").version,
    source: "lockfile",
  },
  {
    id: "node-http",
    adapter: "node",
    package: "node",
    version: process.version,
    source: "runtime",
  },
];
if (values["baseline-root"])
  targets.unshift(await checkout(path.resolve(values["baseline-root"]), "nova-baseline"));
if (values.targets) {
  const selected = values.targets.split(",");
  if (
    new Set(selected).size !== selected.length ||
    selected.some((id) => !targets.some((t) => t.id === id))
  )
    throw new Error("目标列表无效");
  targets = targets.filter((t) => selected.includes(t.id));
}
const meta = metadata(root);
meta.baseline = targets.find((target) => target.baseline) ?? null;
const batch = `${Date.now()}-${process.pid}`;
const output = path.join(root, ".tmp/benchmark/results", batch);
await fs.mkdir(output, { recursive: true });
if (process.env.GITHUB_OUTPUT)
  await fs.appendFile(process.env.GITHUB_OUTPUT, `results=${output}\n`);
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => abort.abort());
console.log(`结果目录: ${output}`);
const records = await run({
  targets,
  scenario: scenarios[values.scenario],
  scenarioName: values.scenario,
  profile: profiles[values.profile],
  profileName: values.profile,
  metadata: meta,
  signal: abort.signal,
  onRecord: async (record) => {
    await fs.writeFile(
      path.join(output, `${record.target.id}.json`),
      JSON.stringify(record, null, 2),
    );
    console.log(
      `${record.target.id}: ${record.rounds.at(-1).status} ${record.rounds.at(-1).reason ?? ""}`,
    );
  },
});
const text = summary(records);
await fs.writeFile(path.join(output, "summary.md"), text);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, text);
const manifest = {
  schemaVersion: 1,
  kind: "current",
  suite: "http-v1",
  profile: values.profile,
  scenario: values.scenario,
  repository: meta.source.repository,
  runId: meta.source.runId,
  runAttempt: meta.source.runAttempt,
  workflowId: process.env.BENCH_WORKFLOW_ID ? Number(process.env.BENCH_WORKFLOW_ID) : null,
  workflowPath: ".github/workflows/benchmark.yml",
  commitSha: meta.source.workflowSha,
  artifactName: meta.source.runId
    ? `benchmark-${meta.source.runId}-${meta.source.runAttempt}`
    : null,
  files: records.map((r) => `${r.target.id}.json`),
  status: records.every((r) => r.rounds.every((round) => round.status === "success"))
    ? "success"
    : "failed",
  replaces: null,
};
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
if (process.env.GITHUB_OUTPUT)
  await fs.appendFile(process.env.GITHUB_OUTPUT, `results=${output}\n`);
if (manifest.status !== "success") process.exitCode = 1;
