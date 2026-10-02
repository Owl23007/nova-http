import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summary, validateRecord } from "./results.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = path.join(root, ".benchmark/http-v1");
const sections = [];
for (const directory of await fs.readdir(source).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
})) {
  const batch = path.join(source, directory);
  const manifest = JSON.parse(await fs.readFile(path.join(batch, "manifest.json"), "utf8"));
  const records = [];
  for (const name of manifest.files) {
    if (!/^[a-z0-9-]+\.json$/.test(name)) throw new Error("非法结果路径");
    records.push(validateRecord(JSON.parse(await fs.readFile(path.join(batch, name), "utf8"))));
  }
  sections.push(`## 批次 ${directory}\n\n${summary(records)}`);
}
const output = path.join(root, ".tmp/benchmark/results/archive-summary.md");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, sections.length ? sections.join("\n\n") : "# 尚无正式归档数据\n");
console.log(output);
