import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { decodeArtifact } from "../report/artifact.js";

function zip(entries) {
  return execFileSync(
    "python",
    [
      "-c",
      `import sys,io,json,zipfile
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 for name,mode in json.loads(sys.stdin.read()):
  i=zipfile.ZipInfo(name)
  i.external_attr=mode<<16
  z.writestr(i,'{}')
sys.stdout.buffer.write(b.getvalue())`,
    ],
    { input: JSON.stringify(entries), stdio: ["pipe", "pipe", "pipe"] },
  );
}
it("读取普通 JSON 文件", () => {
  expect(decodeArtifact(zip([["manifest.json", 0o100644]]))).toEqual({ "manifest.json": "{}" });
});
for (const [name, entries] of [
  ["目录逃逸", [["../manifest.json", 0o100644]]],
  ["符号链接", [["manifest.json", 0o120777]]],
  ["特殊文件", [["manifest.json", 0o020644]]],
  [
    "重复文件",
    [
      ["manifest.json", 0o100644],
      ["manifest.json", 0o100644],
    ],
  ],
  ["脚本", [["run.js", 0o100644]]],
  ["目录", [["folder/", 0o040755]]],
])
  it(`拒绝 Artifact ${name}`, () => {
    expect(() => decodeArtifact(zip(entries))).toThrow();
  });
