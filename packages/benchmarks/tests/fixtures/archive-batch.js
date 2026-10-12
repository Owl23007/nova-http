import { loads } from "../../config/loads.js";
import { profiles, orderForRound } from "../../config/profiles.js";
import { digest, metrics, summarize } from "../../report/results.js";
import { rcWorkflowPath } from "../../report/archive.js";
import { scenarios } from "../../suites/http/scenarios.js";

export function archiveBatchFixture() {
  const ids = ["nova-current", "fastify-schema", "fastify-no-schema", "node-http", "nova-baseline"];
  const sha = "a".repeat(40);
  const baselineSha = "b".repeat(40);
  const repository = "owner/repo";
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
    workflowPath: rcWorkflowPath,
    commitSha: sha,
    artifactName: "benchmark-123-2",
    files: ids.map((id) => `${id}.json`),
    status: "success",
  };
  const files = { "manifest.json": JSON.stringify(manifest) };

  ids.forEach((id, targetIndex) => {
    const rounds = Array.from({ length: 3 }, (_, round) => {
      const raw = {
        requests: { average: 1000 + targetIndex * 100 + round * 10 },
        throughput: { average: 10000 },
        latency: { p50: 1, p90: 2, p99: 3 + targetIndex + round, average: 1.5 },
        errors: 0,
        timeouts: 0,
        non2xx: 0,
        mismatches: 0,
      };
      return {
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
      };
    });
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
        adapter: id.startsWith("nova-") ? "nova" : id === "node-http" ? "node" : "fastify",
        source: id === "node-http" ? "runtime" : id.startsWith("fastify") ? "lockfile" : "checkout",
        sha: id === "nova-baseline" ? baselineSha : sha,
        dirty: false,
        ...(id === "nova-baseline" ? { baseline: true } : {}),
      },
      metadata: {
        driverSha: sha,
        dirty: false,
        baseline: { id: "nova-baseline", sha: baselineSha },
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
          event: "workflow_dispatch",
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
  });

  return { files, manifest };
}
