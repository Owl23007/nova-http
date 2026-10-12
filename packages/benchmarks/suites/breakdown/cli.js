import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync, execFile } from "node:child_process";
import { parseArgs, promisify } from "node:util";
import { metadata, git } from "../../report/metadata.js";
import { run } from "../../runner/engine.js";
import { startTarget } from "../../runner/process.js";
import { measure } from "../http/driver.js";
import { scenarios } from "../http/scenarios.js";
import { loads, presets, select, matrix } from "./config.js";
import { createProbe, requestProbe } from "./telemetry.js";
import { report } from "./report.js";
import { summarizeProfile } from "./profile.js";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const { values } = parseArgs({
  options: {
    preset: { type: "string", default: "smoke" },
    scenarios: { type: "string" },
    loads: { type: "string" },
    targets: { type: "string" },
    stage: { type: "string", default: "all" },
    "cpu-profile": { type: "boolean", default: false },
  },
});
if (!Object.hasOwn(presets, values.preset)) throw new Error("Unknown preset");
if (!["all", "http", "micro"].includes(values.stage)) throw new Error("Unknown stage");
const preset = presets[values.preset];
const entry = path.join(root, "packages/nova-http/dist/src/index.js");
const nova = {
  adapter: "nova",
  entry,
  version: require("nova-http/package.json").version,
  sha: git(root, "rev-parse", "HEAD"),
  dirty: git(root, "status", "--porcelain") !== "",
};
const available = {
  "nova-current": { ...nova, id: "nova-current" },
  "fastify-schema": {
    id: "fastify-schema",
    adapter: "fastify",
    schema: true,
    version: require("fastify/package.json").version,
  },
  "fastify-no-schema": {
    id: "fastify-no-schema",
    adapter: "fastify",
    schema: false,
    version: require("fastify/package.json").version,
  },
  "node-http": { id: "node-http", adapter: "node", version: process.version },
  "nova-preencoded": { ...nova, id: "nova-preencoded", diagnostic: "preencoded" },
  "nova-direct": { ...nova, id: "nova-direct", diagnostic: "direct" },
};
const cells = matrix(
  select(values.scenarios, scenarios),
  select(values.loads, loads),
  select(values.targets, available).map((key) => available[key]),
);
if (!cells.length && values.stage !== "micro") throw new Error("Empty HTTP matrix");
if (!process.env.npm_execpath) throw new Error("Run through pnpm bench:breakdown");
execFileSync(process.execPath, [process.env.npm_execpath, "--filter", "nova-http", "build"], {
  cwd: root,
  stdio: "inherit",
});
const output = path.join(
  root,
  ".tmp/benchmark/results/breakdown-v1",
  `${Date.now()}-${process.pid}`,
);
await fs.mkdir(output, { recursive: true });
const write = (name, value) =>
  fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2));
const manifest = {
  suite: "breakdown-v1",
  schemaVersion: 1,
  status: "running",
  options: values,
  preset,
  metadata: metadata(root),
  cells,
  files: [],
};
await write("manifest.json", manifest);
if (process.env.GITHUB_OUTPUT)
  await fs.appendFile(process.env.GITHUB_OUTPUT, `results=${output}\n`);
console.log(`Breakdown output: ${output}`);
console.log(
  `HTTP rounds: ${values.stage === "micro" ? 0 : cells.reduce((sum, cell) => sum + cell.targets.length * preset.rounds, 0)}`,
);
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => abort.abort());
const records = [];
let micro = [];
// 所有目标顺序运行并复用正式套件的响应、流水线和错误校验
try {
  if (values.stage !== "http") {
    // 微基准与 HTTP 驱动隔离进程，防止组件分配残留改变客户端 GC 和内存
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("./micro-worker.js", import.meta.url)), JSON.stringify(preset)],
      { signal: abort.signal, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
    );
    micro = JSON.parse(stdout);
    await write("micro.json", {
      suite: "breakdown-micro-v1",
      metadata: manifest.metadata,
      preset,
      results: micro,
    });
    manifest.files.push("micro.json");
  }
  if (values.stage !== "micro")
    for (const cell of cells) {
      if (abort.signal.aborted) throw new Error("Run cancelled");
      const phases = new Map();
      const batch = await run({
        targets: cell.targets,
        scenario: scenarios[cell.scenario],
        scenarioName: cell.scenario,
        profile: {
          warmup: preset.warmup,
          duration: preset.duration,
          rounds: preset.rounds,
        },
        profileName: `breakdown-${values.preset}`,
        loadConfig: loads[cell.load],
        loadName: cell.load,
        metadata: manifest.metadata,
        signal: abort.signal,
        start: async (target, scenario, options) => {
          const server = await startTarget(target, scenario, {
            ...options,
            server: new URL("./server.js", import.meta.url),
          });
          phases.set(server.child, { target: target.id, phase: 0 });
          return server;
        },
        load: async (port, scenario, profile, duration, options) => {
          const state = phases.get(options.child);
          const measuring = state.phase++ === 1;
          await requestProbe(options.child, "start", values["cpu-profile"] && measuring);
          const stop = createProbe();
          let client;
          try {
            const result = await measure(port, scenario, profile, duration, options);
            client = stop();
            const server = await requestProbe(options.child, "stop");
            if (server.profile) {
              server.profileSummary = summarizeProfile(server.profile);
              const filename = `${cell.scenario}-${cell.load}-${state.target}-${options.child.pid}.cpuprofile`;
              await write(filename, server.profile);
              delete server.profile;
              server.profileFile = filename;
            }
            return { ...result, resources: { client, server } };
          } finally {
            if (!client) stop();
          }
        },
        onRecord: async (record) => {
          // 带采样的诊断结果使用独立 schema，避免混入正式 http-v1 归档
          record.suite = "breakdown-v1";
          record.cell = cell.load;
          const filename = `${cell.scenario}-${cell.load}-${record.target.id}.json`;
          await write(filename, record);
          if (!manifest.files.includes(filename)) manifest.files.push(filename);
          // 每轮同步索引，异常中断时仍可找到已落盘的部分结果
          await write("manifest.json", manifest);
          console.log(
            `${cell.scenario}/${cell.load}/${record.target.id}: ${record.rounds.at(-1).status} ${record.rounds.at(-1).reason ?? ""}`,
          );
        },
      });
      records.push(...batch);
      await fs.writeFile(path.join(output, "summary.md"), report(records, micro, values.preset));
      await write("manifest.json", manifest);
    }
  manifest.status = records.every(
    (r) =>
      r.rounds.length === preset.rounds && r.rounds.every((round) => round.status === "success"),
  )
    ? "success"
    : "failed";
} catch (error) {
  manifest.status = "failed";
  manifest.reason = error.message;
  console.error(error);
} finally {
  await write("manifest.json", manifest);
  const text = report(records, micro, values.preset);
  await fs.writeFile(path.join(output, "summary.md"), text);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, text);
}
if (manifest.status !== "success") process.exitCode = 1;
