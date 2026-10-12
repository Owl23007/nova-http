import { describe, it, expect } from "vitest";
import {
  validateBatch,
  validateLegacyCleanup,
  verifyProvenance,
  validatePullRequest,
  workflowPath,
  rcWorkflowPath,
} from "../report/archive.js";
import { digest, metrics, summarize } from "../report/results.js";
import { profiles, orderForRound } from "../config/profiles.js";
import { loads } from "../config/loads.js";
import { scenarios } from "../suites/http/scenarios.js";
import { loadVerifiedBatch } from "../report/remote.js";
import { archiveBatchPath, parseArchiveFile } from "../report/archive-layout.js";

const sha = "a".repeat(40);
const repository = "owner/repo";
function fixture() {
  const ids = ["nova-current", "fastify-schema", "fastify-no-schema", "node-http"];
  const manifest = {
    schemaVersion: 1,
    kind: "current",
    suite: "http-v1",
    profile: "full",
    load: "pipeline-10",
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
        ...loads["pipeline-10"],
        ...profiles.full,
        method: "GET",
        bodyBytes: 0,
        profile: "full",
        load: "pipeline-10",
        scenario: "json-small",
        configDigest: digest({
          profile: profiles.full,
          load: loads["pipeline-10"],
          scenario: scenarios["json-small"],
        }),
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
    head: { ref: "benchmark/123-2", repo: { full_name: repository } },
  };
  const changes = Object.keys(files).map((name) => ({
    status: "added",
    filename: `.benchmark/historical/http-v1/123-2/${name}`,
  }));
  return { manifest, files, run, artifact, api, pr, changes };
}

function legacyFixture(profile) {
  const f = fixture();
  const loadName = profile === "fastify" ? "pipeline-10" : "pipeline-1";
  const legacyProfile = { ...loads[loadName], ...profiles.full };
  f.manifest.profile = profile;
  delete f.manifest.load;
  f.files["manifest.json"] = JSON.stringify(f.manifest);
  for (const name of f.manifest.files) {
    const record = JSON.parse(f.files[name]);
    Object.assign(record.load, legacyProfile, {
      profile,
      configDigest: digest({
        profile: legacyProfile,
        scenario: scenarios[record.load.scenario],
      }),
    });
    delete record.load.load;
    f.files[name] = JSON.stringify(record);
  }
  return f;
}

function historicalFixture(profile = "fastify") {
  const f = legacyFixture(profile);
  const versions = {
    "nova-0-1-1": "0.1.1",
    "nova-0-2-0": "0.2.0",
    "nova-0-2-1": "0.2.1",
  };
  const ids = [...Object.keys(versions), "fastify-schema", "fastify-no-schema", "node-http"];
  const current = JSON.parse(f.files["nova-current.json"]);
  delete f.files["nova-current.json"];
  for (const [id, version] of Object.entries(versions)) {
    const record = structuredClone(current);
    record.target = {
      id,
      version,
      package: "nova-http",
      source: "npm",
      adapter: "nova",
      entry: `/tmp/nova-http-${version}/dist/src/index.js`,
      sha: null,
      tagSha: "b".repeat(40),
      npmGitHead: "c".repeat(40),
      integrity: "sha512-valid",
      tarball: `https://registry.npmjs.org/nova-http/-/nova-http-${version}.tgz`,
      publishedAt: "2026-01-01T00:00:00.000Z",
      shaUnavailableReason: "npm tarball 不以标签 SHA 证明源码身份",
      bodyAPI: "legacy",
    };
    f.files[`${id}.json`] = JSON.stringify(record);
  }
  f.manifest.kind = "historical-initialization";
  f.manifest.files = ids.map((id) => `${id}.json`);
  f.manifest.initialization = {
    previousBatch: profile === "no-pipeline" ? { runId: "122", runAttempt: "1" } : null,
    completed:
      profile === "no-pipeline"
        ? ["http-v1/json-small/fastify", "http-v1/json-small/no-pipeline"]
        : ["http-v1/json-small/fastify"],
    status: profile === "no-pipeline" ? "complete" : "incomplete",
  };
  for (const name of f.manifest.files) {
    const record = JSON.parse(f.files[name]);
    for (const round of record.rounds) round.order = orderForRound(ids, round.round);
    f.files[name] = JSON.stringify(record);
  }
  f.files["manifest.json"] = JSON.stringify(f.manifest);
  return f;
}

function rcFixture() {
  const f = fixture();
  const baselineId = "nova-baseline";
  const baselineSha = "b".repeat(40);
  const ids = [...f.manifest.files.map((name) => name.slice(0, -5)), baselineId];
  f.manifest.workflowPath = rcWorkflowPath;
  f.manifest.files.push(`${baselineId}.json`);
  for (const name of f.manifest.files.slice(0, -1)) {
    const record = JSON.parse(f.files[name]);
    record.metadata.baseline = { id: baselineId, sha: baselineSha };
    record.metadata.source.event = "workflow_dispatch";
    for (const round of record.rounds) round.order = orderForRound(ids, round.round);
    f.files[name] = JSON.stringify(record);
  }
  const baseline = JSON.parse(f.files["nova-current.json"]);
  baseline.target = {
    ...baseline.target,
    id: baselineId,
    sha: baselineSha,
    baseline: true,
  };
  f.files[`${baselineId}.json`] = JSON.stringify(baseline);
  f.files["manifest.json"] = JSON.stringify(f.manifest);
  return f;
}

describe("归档拒绝不完整来源", () => {
  it("按 Historical 与 Release 模型生成和解析归档路径", () => {
    expect(archiveBatchPath(fixture().manifest)).toBe(".benchmark/historical/http-v1/123-2/");
    expect(archiveBatchPath({ ...fixture().manifest, releaseTag: "v1.2.3-rc.1" })).toBe(
      ".benchmark/releases/v1.2.3-rc.1/http-v1/123-2/",
    );
    expect(parseArchiveFile(".benchmark/historical/http-v1/123-2/manifest.json")).toMatchObject({
      collection: "historical",
      suite: "http-v1",
      batch: "123-2",
    });
    expect(parseArchiveFile(".benchmark/http-v1/123-2/manifest.json")).toBeNull();
  });
  it("按确切 run 与 attempt 获取并校验 Artifact", async () => {
    const f = fixture();
    const loaded = await loadVerifiedBatch(repository, "123", "2", f.api, async () => f.files);
    expect(loaded.manifest).toEqual(f.manifest);
    await expect(
      loadVerifiedBatch(repository, "123", "1", f.api, async () => f.files),
    ).rejects.toThrow();
    await expect(
      loadVerifiedBatch(repository, "../123", "2", f.api, async () => f.files),
    ).rejects.toThrow();
  });
  it("测量批次失败或 Artifact 过期不允许归档", async () => {
    const f = fixture();
    f.run.conclusion = "failure";
    await expect(
      loadVerifiedBatch(repository, "123", "2", f.api, async () => f.files),
    ).rejects.toThrow();
    f.run.conclusion = "success";
    f.artifact.expired = true;
    await expect(
      loadVerifiedBatch(repository, "123", "2", f.api, async () => f.files),
    ).rejects.toThrow();
  });
  for (const kind of ["unknown", undefined])
    it(`拒绝未知的归档模式 ${kind}`, () => {
      const f = fixture();
      f.manifest.kind = kind;
      f.files["manifest.json"] = JSON.stringify(f.manifest);
      expect(() => validateBatch(f.files)).toThrow("Only supported measurements can be archived");
    });
  it("仅接受成功批次与相同 Artifact", async () => {
    const f = fixture();
    expect(validateBatch(f.files)).toEqual(f.manifest);
    expect(await verifyProvenance(f.manifest, f.api)).toBe(f.artifact);
    expect(() =>
      validatePullRequest(f.pr, f.changes, [], f.files, f.files, f.manifest),
    ).not.toThrow();
  });
  it("发布归档使用 release 目录和独立机器人分支", () => {
    const f = fixture();
    f.pr.head.ref = "benchmark/v1.2.3-123-2";
    f.changes = f.changes.map((change) => ({
      ...change,
      filename: change.filename.replace(".benchmark/historical/", ".benchmark/releases/v1.2.3/"),
    }));
    expect(() =>
      validatePullRequest(f.pr, f.changes, [], f.files, f.files, f.manifest, {
        releaseTag: "v1.2.3",
      }),
    ).not.toThrow();
  });
  it("仅允许完整删除与 historical 字节一致的 legacy 归档", () => {
    const changes = [
      {
        status: "removed",
        filename: ".benchmark/http-v1/123-2/manifest.json",
        sha: "c".repeat(40),
      },
    ];
    const masterTree = [
      {
        path: changes[0].filename,
        type: "blob",
        mode: "100644",
        sha: changes[0].sha,
      },
      {
        path: ".benchmark/historical/http-v1/123-2/manifest.json",
        type: "blob",
        mode: "100644",
        sha: changes[0].sha,
      },
    ];
    expect(() => validateLegacyCleanup(changes, masterTree)).not.toThrow();

    masterTree[1].sha = "d".repeat(40);
    expect(() => validateLegacyCleanup(changes, masterTree)).toThrow(
      "Legacy cleanup must remove complete byte-identical migrated archives",
    );
  });
  it("RC 候选必须包含 Previous Release 基线", () => {
    const f = fixture();
    f.manifest.workflowPath = rcWorkflowPath;
    for (const name of f.manifest.files) {
      const record = JSON.parse(f.files[name]);
      record.metadata.source.event = "workflow_dispatch";
      f.files[name] = JSON.stringify(record);
    }
    f.files["manifest.json"] = JSON.stringify(f.manifest);
    expect(() => validateBatch(f.files)).toThrow("Invalid official target set");
    expect(validateBatch(rcFixture().files).workflowPath).toBe(rcWorkflowPath);
  });
  it("按 manifest 中声明的 RC workflow 验证来源", async () => {
    const f = rcFixture();
    f.run.path = rcWorkflowPath;
    f.run.event = "workflow_dispatch";
    const api = async (endpoint) =>
      endpoint.includes("/workflows/")
        ? { id: 7, path: rcWorkflowPath }
        : endpoint.includes("/artifacts?")
          ? { total_count: 1, artifacts: [f.artifact] }
          : f.run;
    await expect(verifyProvenance(f.manifest, api)).resolves.toBe(f.artifact);
  });
  for (const profile of ["fastify", "no-pipeline"])
    it(`保留旧归档 profile ${profile} 的只读校验兼容`, () => {
      const f = legacyFixture(profile);
      expect(validateBatch(f.files)).toEqual(f.manifest);
    });
  for (const profile of ["fastify", "no-pipeline"])
    it(`仅迁移固定身份的历史初始化批次 ${profile}`, () => {
      const f = historicalFixture(profile);
      expect(validateBatch(f.files)).toEqual(f.manifest);

      const record = JSON.parse(f.files["nova-0-1-1.json"]);
      record.target.version = "9.9.9";
      f.files["nova-0-1-1.json"] = JSON.stringify(record);
      expect(() => validateBatch(f.files)).toThrow("Invalid historical Nova identity");
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
