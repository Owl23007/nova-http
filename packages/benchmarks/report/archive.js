import { validateRecord, digest } from "./results.js";
import { profiles, orderForRound } from "../config/profiles.js";
import { scenarios } from "../suites/http/scenarios.js";
export const workflowPath = ".github/workflows/benchmark.yml";
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const numericId = (value) => typeof value === "string" && /^[1-9]\d*$/.test(value);

export function validateBatch(files) {
  assert(files && Object.hasOwn(files, "manifest.json"), "缺少 manifest");
  const manifest = JSON.parse(files["manifest.json"]);
  assert(manifest.schemaVersion === 1 && manifest.suite === "http-v1", "套件身份无效");
  assert(manifest.kind === "current", "仅接受当前版本测量归档");
  assert(
    ["fastify", "no-pipeline"].includes(manifest.profile) &&
      Object.hasOwn(scenarios, manifest.scenario),
    "正式负载无效",
  );
  assert(numericId(manifest.runId) && numericId(manifest.runAttempt), "运行身份无效");
  assert(
    /^[\da-f]{40}$/.test(manifest.commitSha) &&
      manifest.workflowPath === workflowPath &&
      Number.isInteger(manifest.workflowId),
    "workflow 身份无效",
  );
  assert(
    manifest.artifactName === `benchmark-${manifest.runId}-${manifest.runAttempt}` &&
      manifest.status === "success",
    "批次未成功或 Artifact 名称无效",
  );
  assert(
    Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      new Set(manifest.files).size === manifest.files.length,
    "目标文件列表无效",
  );
  assert(
    manifest.files.every((name) => /^[a-z0-9-]+\.json$/.test(name) && name !== "manifest.json"),
    "目标文件路径无效",
  );
  assert(
    JSON.stringify(Object.keys(files).toSorted()) ===
      JSON.stringify(["manifest.json", ...manifest.files].toSorted()),
    "批次文件集合不完整",
  );
  const identities = [];
  let environmentDigest;
  for (const name of manifest.files) {
    const record = validateRecord(JSON.parse(files[name]));
    const target = record.target;
    if (target.id === "node-http")
      assert(
        target.adapter === "node" &&
          target.package === "node" &&
          target.version === "v24.21.0" &&
          target.source === "runtime",
        "Node 对照身份无效",
      );
    else if (target.id.startsWith("fastify-"))
      assert(
        target.adapter === "fastify" &&
          target.package === "fastify" &&
          target.version === "5.6.1" &&
          target.source === "lockfile" &&
          target.schema === (target.id === "fastify-schema"),
        "Fastify 对照身份无效",
      );
    else assert(target.adapter === "nova" && target.package === "nova-http", "Nova 身份无效");
    identities.push(record.target.id);
    assert(
      name === `${record.target.id}.json` &&
        record.suite === manifest.suite &&
        record.load.profile === manifest.profile &&
        record.load.scenario === manifest.scenario,
      "目标与批次不匹配",
    );
    const profile = profiles[manifest.profile];
    assert(
      Object.entries(profile).every(([key, value]) => record.load[key] === value),
      "负载参数不一致",
    );
    assert(
      record.load.configDigest === digest({ profile, scenario: scenarios[manifest.scenario] }),
      "场景摘要不一致",
    );
    assert(
      record.load.method === scenarios[manifest.scenario].method &&
        record.load.bodyBytes === Buffer.byteLength(scenarios[manifest.scenario].body ?? ""),
      "请求负载描述不一致",
    );
    assert(
      record.adapterVersion === 1 &&
        record.metadata.driverSha === manifest.commitSha &&
        record.metadata.dirty === false,
      "驱动身份无效",
    );
    const source = record.metadata.source;
    assert(
      source.kind === "github-actions" &&
        source.repository === manifest.repository &&
        source.runId === manifest.runId &&
        source.runAttempt === manifest.runAttempt &&
        source.workflowSha === manifest.commitSha,
      "记录来源不匹配",
    );
    assert(["push", "schedule", "workflow_dispatch"].includes(source.event), "非正式测量事件");
    const env = record.metadata.environment;
    environmentDigest ??= digest(env);
    assert(environmentDigest === digest(env), "同批次环境不一致");
    assert(
      env.node === "v24.21.0" &&
        env.autocannon === "8.0.0" &&
        env.fastify === "5.6.1" &&
        env.os === "linux" &&
        env.arch === "x64" &&
        env.runnerImage &&
        env.runnerImageVersion &&
        env.cpu &&
        env.cores > 0 &&
        env.memory > 0,
      "正式环境字段不完整或不一致",
    );
    assert(
      record.rounds.length === profile.rounds &&
        record.rounds.every((r, i) => r.status === "success" && r.round === i),
      "存在失败或重复轮次",
    );
    if (record.target.adapter === "nova")
      assert(
        record.target.source === "checkout" &&
          record.target.sha === manifest.commitSha &&
          record.target.dirty === false,
        "被测源码身份无效",
      );
    for (const r of record.rounds)
      assert(
        Array.isArray(r.order) &&
          new Set(r.order).size === manifest.files.length &&
          r.order.every((id) => manifest.files.includes(`${id}.json`)),
        "执行顺序不完整",
      );
    for (const r of record.rounds)
      assert(
        digest(r.order) ===
          digest(
            orderForRound(
              manifest.files.map((file) => file.slice(0, -5)),
              r.round,
            ),
          ),
        "未按轮次轮换顺序",
      );
  }
  assert(
    JSON.stringify(identities.toSorted()) ===
      JSON.stringify(["fastify-no-schema", "fastify-schema", "node-http", "nova-current"]),
    "正式目标集合无效",
  );
  return manifest;
}

export async function verifyProvenance(manifest, api) {
  const workflow = await api(`/actions/workflows/benchmark.yml`);
  assert(
    workflow.id === manifest.workflowId && workflow.path === workflowPath,
    "不允许的 workflow",
  );
  const run = await api(`/actions/runs/${manifest.runId}/attempts/${manifest.runAttempt}`);
  assert(
    String(run.id) === manifest.runId &&
      String(run.run_attempt) === manifest.runAttempt &&
      run.status === "completed" &&
      run.conclusion === "success",
    "测量未成功完成",
  );
  assert(
    run.repository?.full_name === manifest.repository &&
      run.head_repository?.full_name === manifest.repository &&
      run.head_branch === "master" &&
      run.head_sha === manifest.commitSha &&
      run.workflow_id === workflow.id &&
      run.path === workflowPath &&
      ["push", "schedule", "workflow_dispatch"].includes(run.event),
    "测量来源不可信",
  );
  const artifacts = await api(`/actions/runs/${manifest.runId}/artifacts?per_page=100`);
  const matches = artifacts.artifacts.filter(
    (artifact) => artifact.name === manifest.artifactName && !artifact.expired,
  );
  assert(matches.length === 1 && artifacts.total_count <= 100, "Artifact 缺失、过期或不唯一");
  const artifact = matches[0];
  assert(
    artifact.workflow_run?.id === run.id && artifact.workflow_run?.head_sha === run.head_sha,
    "Artifact 来源无效",
  );
  return artifact;
}

export function validatePullRequest(pr, changes, masterPaths, files, artifactFiles, manifest) {
  assert(
    pr.user?.login === "github-actions[bot]" && pr.user?.id === 41898282 && pr.user?.type === "Bot",
    "仅允许 Action 机器人归档",
  );
  assert(
    pr.base.ref === "master" &&
      pr.base.repo.full_name === manifest.repository &&
      pr.head.repo?.full_name === manifest.repository &&
      pr.head.ref === `benchmark/${manifest.runId}-${manifest.runAttempt}`,
    "归档 PR 来源无效",
  );
  const prefix = `.benchmark/${manifest.suite}/${manifest.runId}-${manifest.runAttempt}/`;
  assert(!masterPaths.some((name) => name.startsWith(prefix)), "批次已存在");
  assert(
    changes.length === Object.keys(files).length &&
      changes.every(
        (change) =>
          change.status === "added" &&
          change.filename.startsWith(prefix) &&
          !masterPaths.includes(change.filename),
      ),
    "归档只能追加新批次",
  );
  assert(
    JSON.stringify(Object.keys(files).toSorted()) ===
      JSON.stringify(Object.keys(artifactFiles).toSorted()),
    "Artifact 文件集合不一致",
  );
  for (const [name, content] of Object.entries(files))
    assert(content === artifactFiles[name], "Artifact 内容不一致");
}
