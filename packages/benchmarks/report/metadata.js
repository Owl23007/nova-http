import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function git(cwd, ...args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function metadata(root) {
  const env = process.env;
  const actions = env.GITHUB_ACTIONS === "true";
  return {
    driverSha: git(root, "rev-parse", "HEAD"),
    methodologyChanged: process.env.BENCH_METHODOLOGY_CHANGED === "true",
    dirty: git(root, "status", "--porcelain") !== "",
    source: {
      kind: actions ? "github-actions" : "local",
      repository: actions ? env.GITHUB_REPOSITORY : null,
      runId: actions ? env.GITHUB_RUN_ID : null,
      runAttempt: actions ? env.GITHUB_RUN_ATTEMPT : null,
      runUrl: actions
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
      event: actions ? env.GITHUB_EVENT_NAME : "local",
      workflowRef: actions ? env.GITHUB_WORKFLOW_REF : null,
      workflowSha: actions ? env.GITHUB_SHA : null,
      prHeadSha: env.BENCH_PR_HEAD_SHA || null,
      prNumber: env.BENCH_PR_NUMBER || null,
      unavailableReason: actions ? null : "本地运行没有 GitHub Actions 来源",
    },
    environment: {
      node: process.version,
      autocannon: require("autocannon/package.json").version,
      fastify: require("fastify/package.json").version,
      os: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? null,
      cores: os.availableParallelism(),
      memory: os.totalmem(),
      runnerImage: env.ImageOS ?? null,
      runnerImageVersion: env.ImageVersion ?? null,
      runnerUnavailableReason: env.ImageVersion ? null : "运行环境未提供镜像版本",
    },
  };
}
