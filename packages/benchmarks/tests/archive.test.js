import { describe, it, expect } from "vitest";
import {
  validateBatch,
  verifyProvenance,
  validatePullRequest,
  workflowPath,
  validateInitialization,
} from "../report/archive.js";
import { digest, metrics, summarize } from "../report/results.js";
import { profiles, orderForRound } from "../config/profiles.js";
import { scenarios } from "../suites/http/scenarios.js";

const sha = "a".repeat(40);
const repository = "owner/repo";
function fixture() {
  const ids = ["nova-current", "fastify-schema", "fastify-no-schema", "node-http"];
  const manifest = {
    schemaVersion: 1,
    suite: "http-v1",
    profile: "fastify",
    scenario: "json-small",
    repository,
    runId: "123",
    runAttempt: "2",
    workflowId: 7,
    workflowPath,
    commitSha: sha,
    artifactName: "benchmark-123-2",
    files: ids.map((id) => `${id}.json`),
    status: "success",
  };
  const raw = {
    requests: { average: 100 },
    throughput: { average: 1000 },
    latency: { p50: 1, p90: 2, p99: 3, average: 1.5 },
    errors: 0,
    timeouts: 0,
    non2xx: 0,
    mismatches: 0,
  };
  const files = { "manifest.json": JSON.stringify(manifest) };
  for (const id of ids) {
    const rounds = Array.from({ length: 3 }, (_, round) => ({
      status: "success",
      round,
      measuredAt: "2026-10-02T00:00:00.000Z",
      validation: { before: true, after: true, pipelineBefore: true, pipelineAfter: true },
      order: orderForRound(ids, round),
      raw,
      rawDigest: digest(raw),
      metrics: metrics(raw),
      invalid: 0,
      checked: 1,
      sampling: "all-responses",
    }));
    files[`${id}.json`] = JSON.stringify({
      schemaVersion: 1,
      suite: "http-v1",
      adapterVersion: 1,
      measuredAt: "2026-10-02T00:00:00.000Z",
      target: {
        id,
        version: id === "node-http" ? "v24.21.0" : id.startsWith("fastify") ? "5.6.1" : "1",
        package: id === "node-http" ? "node" : id.startsWith("fastify") ? "fastify" : "nova-http",
        schema: id === "fastify-schema",
        adapter: id === "nova-current" ? "nova" : id === "node-http" ? "node" : "fastify",
        source: id === "node-http" ? "runtime" : id.startsWith("fastify") ? "lockfile" : "checkout",
        sha,
        dirty: false,
      },
      metadata: {
        driverSha: sha,
        dirty: false,
        environment: {
          node: "v24.21.0",
          autocannon: "8.0.0",
          fastify: "5.6.1",
          os: "linux",
          arch: "x64",
          runnerImage: "ubuntu24",
          runnerImageVersion: "20261002",
          cpu: "cpu",
          cores: 4,
          memory: 100,
        },
        source: {
          kind: "github-actions",
          repository,
          runId: "123",
          runAttempt: "2",
          workflowSha: sha,
          event: "push",
        },
      },
      load: {
        ...profiles.fastify,
        method: "GET",
        bodyBytes: 0,
        profile: "fastify",
        scenario: "json-small",
        configDigest: digest({ profile: profiles.fastify, scenario: scenarios["json-small"] }),
      },
      rounds,
      statistics: summarize(rounds),
    });
  }
  const run = {
    id: 123,
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    head_branch: "master",
    head_sha: sha,
    workflow_id: 7,
    path: workflowPath,
    event: "push",
  };
  const artifact = {
    id: 4,
    name: manifest.artifactName,
    expired: false,
    workflow_run: { id: 123, head_sha: sha },
  };
  const api = async (endpoint) =>
    endpoint.includes("/workflows/")
      ? { id: 7, path: workflowPath }
      : endpoint.includes("/artifacts?")
        ? { total_count: 1, artifacts: [artifact] }
        : run;
  const pr = {
    user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
    base: { ref: "master", repo: { full_name: repository } },
    head: { ref: "codex/benchmark-123-2", repo: { full_name: repository } },
  };
  const changes = Object.keys(files).map((name) => ({
    status: "added",
    filename: `.benchmark/http-v1/123-2/${name}`,
  }));
  return { manifest, files, run, artifact, api, pr, changes };
}

describe("归档拒绝不完整来源", () => {
  it("历史完成状态仅根据已归档组合推导", () => {
    const first = {
      kind: "historical-initialization",
      suite: "http-v1",
      scenario: "json-small",
      status: "success",
      profile: "fastify",
      initialization: { completed: ["http-v1/json-small/fastify"], status: "incomplete" },
    };
    expect(() => validateInitialization(first, [])).not.toThrow();
    expect(() => validateInitialization(first, [first])).toThrow("已归档");
    const second = {
      ...first,
      profile: "no-pipeline",
      initialization: {
        completed: ["http-v1/json-small/fastify", "http-v1/json-small/no-pipeline"],
        status: "complete",
      },
    };
    expect(() => validateInitialization(second, [first])).not.toThrow();
    expect(() => validateInitialization(second, [])).toThrow();
  });
  it("仅接受成功批次与相同 Artifact", async () => {
    const f = fixture();
    expect(validateBatch(f.files)).toEqual(f.manifest);
    expect(await verifyProvenance(f.manifest, f.api)).toBe(f.artifact);
    expect(() =>
      validatePullRequest(f.pr, f.changes, [], f.files, f.files, f.manifest),
    ).not.toThrow();
  });
  for (const [field, value] of [
    ["status", "in_progress"],
    ["conclusion", "failure"],
    ["run_attempt", 1],
    ["head_sha", "b".repeat(40)],
    ["head_branch", "other"],
    ["workflow_id", 8],
    ["path", "evil.yml"],
    ["event", "pull_request"],
    ["repository", { full_name: "other/repo" }],
    ["head_repository", { full_name: "fork/repo" }],
  ])
    it(`拒绝伪造 run ${field}`, async () => {
      const f = fixture();
      f.run[field] = value;
      await expect(verifyProvenance(f.manifest, f.api)).rejects.toThrow();
    });
  it("API 不可用不降级", async () => {
    const f = fixture();
    await expect(
      verifyProvenance(f.manifest, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
  });
  it("拒绝过期和错 SHA 的 Artifact", async () => {
    const f = fixture();
    f.artifact.expired = true;
    await expect(verifyProvenance(f.manifest, f.api)).rejects.toThrow();
    f.artifact.expired = false;
    f.artifact.workflow_run.head_sha = "fake";
    await expect(verifyProvenance(f.manifest, f.api)).rejects.toThrow();
  });
  it("拒绝目录逃逸、额外文件和缺少文件", () => {
    const f = fixture();
    expect(() => validateBatch({ ...f.files, "../evil.json": "{}" })).toThrow();
    delete f.files["node-http.json"];
    expect(() => validateBatch(f.files)).toThrow();
  });
  it("拒绝目标、原始数据和统计篡改", () => {
    for (const mutate of [
      (r) => {
        r.target.id = "other";
      },
      (r) => {
        r.rounds[0].raw.requests.average = 200;
      },
      (r) => {
        r.statistics.qps.mean = 999;
      },
      (r) => {
        r.load.connections = 1;
      },
      (r) => {
        r.metadata.driverSha = "fake";
      },
      (r) => {
        r.rounds[0].status = "failed";
        r.rounds[0].reason = "error";
      },
    ]) {
      const f = fixture();
      const record = JSON.parse(f.files["nova-current.json"]);
      mutate(record);
      f.files["nova-current.json"] = JSON.stringify(record);
      expect(() => validateBatch(f.files)).toThrow();
    }
  });
  for (const status of ["modified", "removed", "renamed"])
    it(`拒绝历史数据 ${status}`, () => {
      const f = fixture();
      f.changes[0].status = status;
      expect(() =>
        validatePullRequest(f.pr, f.changes, [], f.files, f.files, f.manifest),
      ).toThrow();
    });
  it("拒绝普通用户、重复批次与不一致 Artifact", () => {
    const f = fixture();
    f.pr.user.id = 1;
    expect(() => validatePullRequest(f.pr, f.changes, [], f.files, f.files, f.manifest)).toThrow();
    f.pr.user.id = 41898282;
    expect(() =>
      validatePullRequest(f.pr, f.changes, [f.changes[0].filename], f.files, f.files, f.manifest),
    ).toThrow();
    expect(() =>
      validatePullRequest(
        f.pr,
        f.changes,
        [],
        f.files,
        { ...f.files, "node-http.json": "{}" },
        f.manifest,
      ),
    ).toThrow();
  });
});
