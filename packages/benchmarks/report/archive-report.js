import fs from "node:fs/promises";
import path from "node:path";
import { validateBatch } from "./archive.js";
import { parseArchiveFile } from "./archive-layout.js";
import { formatTargetName } from "./results.js";

export { formatTargetName } from "./results.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const markdownCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const inlineCode = (value) => `\`${String(value).replaceAll("`", "\\`")}\``;
const rounded = (value) => Number(value.toFixed(2));
const number = (value) => rounded(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

function reportRecords(files, manifest) {
  return manifest.files.map((name) => {
    const record = JSON.parse(files[name]);
    const qps = record.statistics?.qps;
    const p99 = record.statistics?.roundP99;
    assert(Number.isFinite(qps?.median) && qps.median > 0, `Invalid QPS median: ${name}`);
    assert(Number.isFinite(qps?.cv) && qps.cv >= 0, `Invalid QPS CV: ${name}`);
    assert(Number.isFinite(p99?.median) && p99.median >= 0, `Invalid p99 median: ${name}`);
    assert(
      Number.isInteger(qps?.count) &&
        qps.count > 0 &&
        qps.count === p99?.count &&
        qps.count === record.load?.rounds,
      `Invalid valid round count: ${name}`,
    );
    return record;
  });
}

function performanceChart(records) {
  const reference = records.find((record) => record.target.id === "node-http");
  assert(reference, "Node HTTP reference is missing");
  const referenceQps = reference.statistics.qps.median;
  const values = records.map((record) =>
    rounded((record.statistics.qps.median / referenceQps) * 100),
  );
  const paddedMaximum = rounded(Math.max(...values) * 1.1);
  const step = 10 ** Math.max(0, Math.floor(Math.log10(paddedMaximum)) - 1);
  const maximum = Math.ceil(paddedMaximum / step) * step;
  const labels = records.map((record) => JSON.stringify(formatTargetName(record.target.id)));
  return [
    "#### Relative Throughput",
    "",
    "QPS is normalized against Node HTTP from the same batch.",
    "",
    "```mermaid",
    "xychart-beta",
    '    title "Relative throughput (Node HTTP = 100%)"',
    `    x-axis [${labels.join(", ")}]`,
    `    y-axis "Relative QPS (%)" 0 --> ${maximum}`,
    `    bar [${values.join(", ")}]`,
    "```",
    "",
  ];
}

function resultsTable(records) {
  const reference = records.find((record) => record.target.id === "node-http");
  const referenceQps = reference.statistics.qps.median;
  return [
    "#### Measured Results",
    "",
    "Higher QPS and lower p99 are better.",
    "",
    "| Target | Median QPS | vs Node HTTP | Median p99 | QPS CV | Valid rounds |",
    "| :--- | ---: | ---: | ---: | ---: | ---: |",
    ...records.map((record) => {
      const { qps, roundP99 } = record.statistics;
      const delta = (qps.median / referenceQps - 1) * 100;
      return `| ${markdownCell(formatTargetName(record.target.id))} | ${number(qps.median)} | ${delta >= 0 ? "+" : ""}${number(delta)}% | ${number(roundP99.median)} ms | ${number(qps.cv * 100)}% | ${qps.count}/${record.load.rounds} |`;
    }),
    "",
  ];
}

export function createArchiveReport(files, { artifactId, archivePath }) {
  const manifest = validateBatch(files);
  assert(/^[1-9]\d*$/.test(String(artifactId)), "Invalid Artifact ID");
  const archive =
    typeof archivePath === "string" ? parseArchiveFile(`${archivePath}manifest.json`) : null;
  assert(
    archive?.suite === manifest.suite &&
      archive.batch === `${manifest.runId}-${manifest.runAttempt}` &&
      archivePath.endsWith("/"),
    "Invalid archive path",
  );
  assert(/^[\w.-]+\/[\w.-]+$/.test(manifest.repository), "Invalid repository");

  const records = reportRecords(files, manifest);
  const first = records[0];
  const load = manifest.load ?? first.load.load;
  const runUrl = `https://github.com/${manifest.repository}/actions/runs/${manifest.runId}/attempts/${manifest.runAttempt}`;
  const source = `[Run #${manifest.runId} (Attempt #${manifest.runAttempt})](${runUrl})`;
  const commitUrl = `https://github.com/${manifest.repository}/commit/${manifest.commitSha}`;
  const commit = `[\`${manifest.commitSha.slice(0, 7)}\`](${commitUrl})`;
  const configuration = [
    ["Suite", inlineCode(manifest.suite)],
    ["Scenario", inlineCode(manifest.scenario)],
    ["Profile", inlineCode(manifest.profile)],
    ...(load ? [["Load", inlineCode(load)]] : []),
  ];
  const details = [
    ["Source run", source],
    ["Commit", commit],
    ["Artifact ID", inlineCode(artifactId)],
    ["Archive Path", inlineCode(archivePath)],
  ];

  return [
    "## Benchmark Archive",
    "",
    "> [!NOTE]",
    "> This PR adds an immutable benchmark batch. The archived JSON files are the source of truth.",
    "",
    "### Run Configuration",
    "",
    "| Field | Value |",
    "| :--- | :--- |",
    ...configuration.map(([label, value]) => `| ${label} | ${value} |`),
    "",
    "### Results",
    "",
    ...(manifest.suite === "http-v1" ? performanceChart(records) : []),
    ...resultsTable(records),
    "### Provenance",
    "",
    "| Field | Value |",
    "| :--- | :--- |",
    ...details.map(([label, value]) => `| ${label} | ${value} |`),
    "",
  ].join("\n");
}

export async function writeArchiveReport(directory, options) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  assert(
    entries.every((entry) => entry.isFile() && /^[a-z0-9-]+\.json$/.test(entry.name)),
    "Archive batch contains an invalid file",
  );
  const files = Object.fromEntries(
    await Promise.all(
      entries.map(async (entry) => [
        entry.name,
        await fs.readFile(path.join(directory, entry.name), "utf8"),
      ]),
    ),
  );
  const report = createArchiveReport(files, options);
  await fs.writeFile(options.outputPath, report, { flag: "wx" });
  return options.outputPath;
}
