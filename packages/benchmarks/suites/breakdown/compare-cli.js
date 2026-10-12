import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { validateRecord } from "../../report/results.js";
import { compare } from "./report.js";

const { values } = parseArgs({
  options: { local: { type: "string" }, remote: { type: "string" } },
});
if (!values.local || !values.remote)
  throw new Error("Provide --local <batch directory> --remote <batch directory>");
async function read(directory) {
  // 比较前重新校验原始摘要、统计和文件名，避免把损坏或缺失数据当作性能差异
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.suite !== "http-v1" || !Array.isArray(manifest.files))
    throw new Error("Expected an http-v1 batch");
  return Promise.all(
    manifest.files.map(async (file) => {
      if (path.basename(file) !== file || !file.endsWith(".json"))
        throw new Error("Invalid record path");
      return validateRecord(JSON.parse(await fs.readFile(path.join(directory, file), "utf8")));
    }),
  );
}
const [local, remote] = await Promise.all([
  read(path.resolve(values.local)),
  read(path.resolve(values.remote)),
]);
const rows = compare(local, remote);
if (!rows.length) throw new Error("No common targets");
console.log(
  JSON.stringify(
    {
      note: "跨环境 QPS 仅作描述比较，不能当作回归测量；CV > 5% 仅为诊断提示，不是显著性检验",
      rows,
    },
    null,
    2,
  ),
);
