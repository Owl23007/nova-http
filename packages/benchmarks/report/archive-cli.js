import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBatch, validatePullRequest } from "./archive.js";
import { createGitHubAPI, loadVerifiedBatch } from "./remote.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const repository = process.env.GITHUB_REPOSITORY;
const api = createGitHubAPI(repository, process.env.GITHUB_TOKEN);
const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
if (process.argv[2] === "check") {
  const number = event.pull_request?.number;
  if (!Number.isInteger(number)) throw new Error("缺少 PR 身份");
  const pr = await api("/pulls/" + number);
  const changes = [];
  for (let page = 1; page <= 30; page++) {
    const chunk = await api("/pulls/" + number + "/files?per_page=100&page=" + page);
    changes.push(...chunk);
    if (chunk.length < 100) break;
  }
  if (changes.length !== pr.changed_files) throw new Error("无法完整读取 PR 文件");
  if (
    !changes.some(
      (c) => c.filename.startsWith(".benchmark/") || c.previous_filename?.startsWith(".benchmark/"),
    )
  ) {
    console.log("PR 未修改归档数据");
  } else {
    const groups = new Map();
    for (const change of changes) {
      if (
        change.status !== "added" ||
        !/^\.benchmark\/http-v1\/[1-9]\d*-[1-9]\d*\/[a-z0-9-]+\.json$/.test(change.filename)
      )
        throw new Error("普通 PR 禁止修改归档数据，归档 PR 仅允许新增 JSON");
      const directory = path.posix.dirname(change.filename);
      if (!groups.has(directory)) groups.set(directory, { files: {}, changes: [] });
      const group = groups.get(directory);
      const blob = await api("/git/blobs/" + change.sha);
      if (blob.size > 10_000_000 || blob.encoding !== "base64")
        throw new Error("文件大小或编码无效");
      const name = path.posix.basename(change.filename);
      if (Object.hasOwn(group.files, name)) throw new Error("重复文件");
      group.files[name] = Buffer.from(blob.content, "base64").toString("utf8");
      group.changes.push(change);
    }
    if (groups.size !== 1) throw new Error("归档只能包含一个批次");
    const batches = [...groups.values()].map((group) => ({
      ...group,
      manifest: validateBatch(group.files),
    }));
    const master = await api("/git/trees/master?recursive=1");
    const head = await api("/git/trees/" + pr.head.sha + "?recursive=1");
    if (master.truncated || head.truncated) throw new Error("无法完整读取 Git 树");
    for (const change of changes)
      if (
        !head.tree.some(
          (entry) =>
            entry.path === change.filename &&
            entry.mode === "100644" &&
            entry.type === "blob" &&
            entry.sha === change.sha,
        )
      )
        throw new Error("禁止符号链接或特殊文件");
    for (const batch of batches) {
      const manifest = batch.manifest;
      if (manifest.repository !== repository) throw new Error("仓库不匹配");
      const verified = await loadVerifiedBatch(
        repository,
        manifest.runId,
        manifest.runAttempt,
        api,
      );
      validatePullRequest(
        pr,
        batch.changes,
        master.tree.map((entry) => entry.path),
        batch.files,
        verified.files,
        manifest,
      );
    }
    if ((await api("/pulls/" + number)).head.sha !== pr.head.sha)
      throw new Error("校验期间 PR 已更新");
    if ((await api("/git/trees/master")).sha !== master.sha)
      throw new Error("校验期间 master 已更新");
    console.log("归档校验通过: " + batches.length + " 个批次");
  }
} else if (process.argv[2] === "promote") {
  const source = event.client_payload;
  if (
    event.action !== "benchmark-archive" ||
    event.repository?.full_name !== repository ||
    !source ||
    !/^[1-9]\d*$/.test(String(source.runId)) ||
    !/^[1-9]\d*$/.test(String(source.runAttempt))
  )
    throw new Error("缺少正式测量事件");
  const current = await loadVerifiedBatch(
    repository,
    String(source.runId),
    String(source.runAttempt),
    api,
  );
  const master = await api("/git/trees/master?recursive=1");
  if (master.truncated) throw new Error("无法完整读取 master");
  const { manifest, files, artifact } = current;
  const prefix = `.benchmark/${manifest.suite}/${manifest.runId}-${manifest.runAttempt}/`;
  if (master.tree.some((entry) => entry.path.startsWith(prefix))) throw new Error("批次已存在");
  const destination = path.join(root, prefix);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination);
  for (const [name, content] of Object.entries(files))
    await fs.writeFile(path.join(destination, name), content, { flag: "wx" });
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `ready=true\nbranch=benchmark/${manifest.runId}-${manifest.runAttempt}\nartifact-id=${artifact.id}\narchive-path=${prefix}\n`,
    );
} else throw new Error("使用 check 或 promote");
