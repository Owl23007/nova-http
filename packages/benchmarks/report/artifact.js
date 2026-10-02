import { execFileSync } from "node:child_process";

export function decodeArtifact(zip) {
  // 仅读取白名单普通 JSON，不向磁盘解压不可信路径
  const python = `import sys,io,zipfile,json,stat,re
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
out={}
size=0
for i in z.infolist():
 size+=i.file_size
 assert size<=30000000 and re.fullmatch(r'[a-z0-9-]+\\.json',i.filename) and i.filename not in out
 mode=i.external_attr>>16
 assert not i.is_dir() and (stat.S_IFMT(mode)==0 or stat.S_ISREG(mode))
 out[i.filename]=z.read(i).decode('utf-8')
print(json.dumps(out))`;
  return JSON.parse(
    execFileSync("python", ["-c", python], {
      input: zip,
      maxBuffer: 35_000_000,
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString(),
  );
}
