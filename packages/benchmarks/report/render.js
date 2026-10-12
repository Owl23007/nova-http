import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summary, validateRecord } from "./results.js";
import { discoverArchiveBatches } from "./archive-layout.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sections = [];
for (const archived of await discoverArchiveBatches(root)) {
  // 各 Suite 维护自己的 schema；当前报告器只读取已经具有严格校验器的 HTTP v1。
  if (archived.suite !== "http-v1") continue;
  const batch = archived.directory;
  const manifest = JSON.parse(await fs.readFile(path.join(batch, "manifest.json"), "utf8"));
  if (manifest.suite !== archived.suite)
    throw new Error("Archive directory and manifest suite do not match");
  const records = [];
  for (const name of manifest.files) {
    if (!/^[a-z0-9-]+\.json$/.test(name)) throw new Error("Invalid result path");
    records.push(validateRecord(JSON.parse(await fs.readFile(path.join(batch, name), "utf8"))));
  }
  const source =
    archived.collection === "release"
      ? `Release ${archived.releaseTag}`
      : archived.collection === "historical"
        ? "Historical"
        : "Legacy Historical";
  sections.push(
    `## ${source} · ${archived.suite} · ${archived.batch}\n\n${summary(records, { heading: "###" })}`,
  );
}
const output = path.join(root, ".tmp/benchmark/results/archive-summary.md");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(
  output,
  sections.length ? sections.join("\n\n") : "# No Archived Benchmarks Yet\n",
);
console.log(output);
