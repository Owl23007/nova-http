import { decodeArtifact } from "./artifact.js";
import {
  validateBatch,
  verifyProvenance,
  validateHistoricalBase,
  validateInitialization,
  validateArchiveSet,
} from "./archive.js";

export function createGitHubAPI(repository, token) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !token)
    throw new Error("缺少 GitHub 来源配置");
  return async (endpoint, raw = false) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${endpoint}`);
    return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}

export async function downloadArtifact(api, artifact) {
  if (artifact.size_in_bytes > 30_000_000) throw new Error("Artifact 超过大小限制");
  return decodeArtifact(await api(`/actions/artifacts/${artifact.id}/zip`, true));
}

export async function selectArchiveBatches(current, archived, loadBatch) {
  const manifest = current.manifest;
  if (manifest.kind === "historical-initialization" && manifest.profile === "fastify") {
    validateHistoricalBase(manifest);
    validateInitialization(manifest, archived);
    return { ready: false, batches: [], anchor: null };
  }
  const batches = [current];
  if (manifest.kind === "historical-initialization") {
    const reference = manifest.initialization?.previousBatch;
    batches.unshift(await loadBatch(reference?.runId, reference?.runAttempt));
  }
  const anchor = validateArchiveSet(
    batches.map((batch) => batch.manifest),
    archived,
  );
  return { ready: true, batches, anchor };
}

export async function loadVerifiedBatch(
  repository,
  runId,
  runAttempt,
  api,
  download = downloadArtifact,
) {
  if (![runId, runAttempt].every((value) => typeof value === "string" && /^[1-9]\d*$/.test(value)))
    throw new Error("批次引用无效");
  const run = await api(`/actions/runs/${runId}/attempts/${runAttempt}`);
  const identity = {
    repository,
    runId,
    runAttempt,
    workflowId: run.workflow_id,
    commitSha: run.head_sha,
    artifactName: `benchmark-${runId}-${runAttempt}`,
  };
  const artifact = await verifyProvenance(identity, api);
  const files = await download(api, artifact);
  const manifest = validateBatch(files);
  if (
    manifest.repository !== repository ||
    manifest.runId !== runId ||
    manifest.runAttempt !== runAttempt ||
    manifest.commitSha !== run.head_sha ||
    manifest.workflowId !== run.workflow_id
  )
    throw new Error("Artifact 与引用批次不匹配");
  return { manifest, files, artifact };
}
