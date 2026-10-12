import { validateRecord, digest } from "./results.js";
import { profiles, orderForRound } from "../config/profiles.js";
import { loads } from "../config/loads.js";
import { scenarios } from "../suites/http/scenarios.js";
import { archiveBatchPath } from "./archive-layout.js";
export const workflowPath = ".github/workflows/benchmark.yml";
export const rcWorkflowPath = ".github/workflows/benchmark-rc.yml";
export const workflowPaths = new Set([workflowPath, rcWorkflowPath]);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const numericId = (value) => typeof value === "string" && /^[1-9]\d*$/.test(value);
const legacyLoads = {
  fastify: "pipeline-10",
  "no-pipeline": "pipeline-1",
};

function archiveConfig(manifest) {
  const legacyLoad = legacyLoads[manifest.profile];
  if (legacyLoad) {
    const config = { ...loads[legacyLoad], ...profiles.full };
    return { config, digestInput: { profile: config }, legacy: true };
  }
  assert(
    manifest.profile === "full" && Object.hasOwn(loads, manifest.load),
    "Invalid official load",
  );
  return {
    config: { ...loads[manifest.load], ...profiles.full },
    digestInput: { profile: profiles.full, load: loads[manifest.load] },
    legacy: false,
  };
}

export function validateBatch(files) {
  assert(files && Object.hasOwn(files, "manifest.json"), "Missing manifest");
  const manifest = JSON.parse(files["manifest.json"]);
  assert(manifest.schemaVersion === 1 && manifest.suite === "http-v1", "Invalid suite identity");
  assert(manifest.kind === "current", "Only current-version measurements can be archived");
  assert(Object.hasOwn(scenarios, manifest.scenario), "Invalid official scenario");
  const resolved = archiveConfig(manifest);
  assert(numericId(manifest.runId) && numericId(manifest.runAttempt), "Invalid run identity");
  assert(
    /^[\da-f]{40}$/.test(manifest.commitSha) &&
      workflowPaths.has(manifest.workflowPath) &&
      Number.isInteger(manifest.workflowId),
    "Invalid workflow identity",
  );
  assert(
    manifest.artifactName === `benchmark-${manifest.runId}-${manifest.runAttempt}` &&
      manifest.status === "success",
    "Batch did not succeed or has an invalid artifact name",
  );
  assert(
    Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      new Set(manifest.files).size === manifest.files.length,
    "Invalid target file list",
  );
  assert(
    manifest.files.every((name) => /^[a-z0-9-]+\.json$/.test(name) && name !== "manifest.json"),
    "Invalid target file path",
  );
  assert(
    JSON.stringify(Object.keys(files).toSorted()) ===
      JSON.stringify(["manifest.json", ...manifest.files].toSorted()),
    "Incomplete batch file set",
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
        "Invalid Node reference identity",
      );
    else if (target.id.startsWith("fastify-"))
      assert(
        target.adapter === "fastify" &&
          target.package === "fastify" &&
          target.version === "5.6.1" &&
          target.source === "lockfile" &&
          target.schema === (target.id === "fastify-schema"),
        "Invalid Fastify reference identity",
      );
    else
      assert(target.adapter === "nova" && target.package === "nova-http", "Invalid Nova identity");
    identities.push(record.target.id);
    assert(
      name === `${record.target.id}.json` &&
        record.suite === manifest.suite &&
        record.load.profile === manifest.profile &&
        (resolved.legacy || record.load.load === manifest.load) &&
        record.load.scenario === manifest.scenario,
      "Target does not match batch",
    );
    assert(
      Object.entries(resolved.config).every(([key, value]) => record.load[key] === value),
      "Load parameters do not match",
    );
    assert(
      record.load.configDigest ===
        digest({ ...resolved.digestInput, scenario: scenarios[manifest.scenario] }),
      "Scenario digest does not match",
    );
    assert(
      record.load.method === scenarios[manifest.scenario].method &&
        record.load.bodyBytes === Buffer.byteLength(scenarios[manifest.scenario].body ?? ""),
      "Request payload description does not match",
    );
    assert(
      record.adapterVersion === 1 &&
        record.metadata.driverSha === manifest.commitSha &&
        record.metadata.dirty === false,
      "Invalid driver identity",
    );
    const source = record.metadata.source;
    assert(
      source.kind === "github-actions" &&
        source.repository === manifest.repository &&
        source.runId === manifest.runId &&
        source.runAttempt === manifest.runAttempt &&
        source.workflowSha === manifest.commitSha,
      "Record provenance does not match",
    );
    assert(
      manifest.workflowPath === rcWorkflowPath
        ? source.event === "workflow_dispatch"
        : ["push", "schedule", "workflow_dispatch"].includes(source.event),
      "Unsupported measurement event",
    );
    const env = record.metadata.environment;
    environmentDigest ??= digest(env);
    assert(environmentDigest === digest(env), "Batch environments do not match");
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
      "Official environment fields are incomplete or inconsistent",
    );
    assert(
      record.rounds.length === resolved.config.rounds &&
        record.rounds.every((r, i) => r.status === "success" && r.round === i),
      "Batch contains failed or duplicate rounds",
    );
    if (record.target.adapter === "nova") {
      const current = record.target.id === "nova-current";
      const baseline = record.target.id === "nova-baseline";
      assert(
        record.target.source === "checkout" &&
          record.target.dirty === false &&
          ((current && record.target.sha === manifest.commitSha) ||
            (baseline &&
              record.target.baseline === true &&
              /^[\da-f]{40}$/.test(record.target.sha))),
        "Invalid measured source identity",
      );
      if (baseline)
        assert(
          record.metadata.baseline?.id === record.target.id &&
            record.metadata.baseline?.sha === record.target.sha,
          "Invalid baseline source identity",
        );
    }
    for (const r of record.rounds)
      assert(
        Array.isArray(r.order) &&
          new Set(r.order).size === manifest.files.length &&
          r.order.every((id) => manifest.files.includes(`${id}.json`)),
        "Incomplete execution order",
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
        "Execution order was not rotated by round",
      );
  }
  const expected = ["fastify-no-schema", "fastify-schema", "node-http", "nova-current"];
  if (manifest.workflowPath === rcWorkflowPath) expected.push("nova-baseline");
  assert(
    JSON.stringify(identities.toSorted()) === JSON.stringify(expected.toSorted()),
    "Invalid official target set",
  );
  return manifest;
}

export async function verifyProvenance(manifest, api) {
  assert(workflowPaths.has(manifest.workflowPath), "Workflow is not allowed");
  const workflowName = manifest.workflowPath.slice(manifest.workflowPath.lastIndexOf("/") + 1);
  const workflow = await api(`/actions/workflows/${workflowName}`);
  assert(
    workflow.id === manifest.workflowId && workflow.path === manifest.workflowPath,
    "Workflow is not allowed",
  );
  const run = await api(`/actions/runs/${manifest.runId}/attempts/${manifest.runAttempt}`);
  assert(
    String(run.id) === manifest.runId &&
      String(run.run_attempt) === manifest.runAttempt &&
      run.status === "completed" &&
      run.conclusion === "success",
    "Measurement did not complete successfully",
  );
  assert(
    run.repository?.full_name === manifest.repository &&
      run.head_repository?.full_name === manifest.repository &&
      run.head_branch === "master" &&
      run.head_sha === manifest.commitSha &&
      run.workflow_id === workflow.id &&
      run.path === manifest.workflowPath &&
      (manifest.workflowPath === rcWorkflowPath
        ? run.event === "workflow_dispatch"
        : ["push", "schedule", "workflow_dispatch"].includes(run.event)),
    "Untrusted measurement provenance",
  );
  const artifacts = await api(`/actions/runs/${manifest.runId}/artifacts?per_page=100`);
  const matches = artifacts.artifacts.filter(
    (artifact) => artifact.name === manifest.artifactName && !artifact.expired,
  );
  assert(
    matches.length === 1 && artifacts.total_count <= 100,
    "Artifact is missing, expired, or not unique",
  );
  const artifact = matches[0];
  assert(
    artifact.workflow_run?.id === run.id && artifact.workflow_run?.head_sha === run.head_sha,
    "Invalid artifact provenance",
  );
  return artifact;
}

export function validatePullRequest(
  pr,
  changes,
  masterPaths,
  files,
  artifactFiles,
  manifest,
  archive = { releaseTag: null },
) {
  assert(
    pr.user?.login === "github-actions[bot]" && pr.user?.id === 41898282 && pr.user?.type === "Bot",
    "Only the GitHub Actions bot may create archives",
  );
  assert(
    pr.base.ref === "master" &&
      pr.base.repo.full_name === manifest.repository &&
      pr.head.repo?.full_name === manifest.repository &&
      pr.head.ref ===
        `benchmark/${archive.releaseTag ? `${archive.releaseTag}-` : ""}${manifest.runId}-${manifest.runAttempt}`,
    "Invalid archive pull request provenance",
  );
  const prefix = archiveBatchPath(
    manifest,
    archive.releaseTag ? { releaseTag: archive.releaseTag } : {},
  );
  assert(!masterPaths.some((name) => name.startsWith(prefix)), "Batch already exists");
  assert(
    changes.length === Object.keys(files).length &&
      changes.every(
        (change) =>
          change.status === "added" &&
          change.filename.startsWith(prefix) &&
          !masterPaths.includes(change.filename),
      ),
    "An archive may only append a new batch",
  );
  assert(
    JSON.stringify(Object.keys(files).toSorted()) ===
      JSON.stringify(Object.keys(artifactFiles).toSorted()),
    "Artifact file set does not match",
  );
  for (const [name, content] of Object.entries(files))
    assert(content === artifactFiles[name], "Artifact content does not match");
}
