import fs from "node:fs/promises";
import path from "node:path";
import { decodeArtifact } from "./artifact.js";
import { fileURLToPath } from "node:url";
import {
  validateBatch,
  validatePullRequest,
  verifyProvenance,
  validateInitialization,
} from "./archive.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const repository = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("仓库身份缺失");
const api = async (endpoint, raw = false) => {
  const response = await fetch(`https://api.github.com/repos/${repository}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${endpoint}`);
  return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
};
const download = async (artifact) => {
  if (artifact.size_in_bytes > 30_000_000) throw new Error("Artifact 超过大小限制");
  const zip = await api(`/actions/artifacts/${artifact.id}/zip`, true);
  return decodeArtifact(zip);
};
const checkInitialization = async (manifest, master) => {
  if (manifest.kind !== "historical-initialization") return;
  const archived = [];
  for (const entry of master.tree.filter((item) =>
    /^\.benchmark\/http-v1\/[1-9]\d*-[1-9]\d*\/manifest\.json$/.test(item.path),
  )) {
    const blob = await api(`/git/blobs/${entry.sha}`);
    archived.push(JSON.parse(Buffer.from(blob.content, "base64").toString("utf8")));
  }
  validateInitialization(manifest, archived);
};
const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
if (process.argv[2] === "check") {
  const number = event.pull_request?.number;
  if (!Number.isInteger(number)) throw new Error("缺少 PR 身份");
  const pr = await api(`/pulls/${number}`);
  const changes = [];
  for (let page = 1; page <= 30; page++) {
    const chunk = await api(`/pulls/${number}/files?per_page=100&page=${page}`);
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
    const files = {};
    for (const change of changes) {
      if (
        change.status !== "added" ||
        !/^\.benchmark\/http-v1\/[1-9]\d*-[1-9]\d*\/[a-z0-9-]+\.json$/.test(change.filename)
      )
        throw new Error("普通 PR 禁止修改归档数据，归档 PR 仅允许新增 JSON");
      const blob = await api(`/git/blobs/${change.sha}`);
      if (blob.size > 10_000_000 || blob.encoding !== "base64")
        throw new Error("文件大小或编码无效");
      const name = path.posix.basename(change.filename);
      if (Object.hasOwn(files, name)) throw new Error("重复文件");
      files[name] = Buffer.from(blob.content, "base64").toString("utf8");
    }
    const manifest = validateBatch(files);
    if (manifest.repository !== repository) throw new Error("仓库不匹配");
    const artifact = await verifyProvenance(manifest, api);
    const master = await api("/git/trees/master?recursive=1");
    const head = await api(`/git/trees/${pr.head.sha}?recursive=1`);
    if (master.truncated || head.truncated) throw new Error("无法完整读取 Git 树");
    await checkInitialization(manifest, master);
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
    validatePullRequest(
      pr,
      changes,
      master.tree.map((entry) => entry.path),
      files,
      await download(artifact),
      manifest,
    );
    const current = await api(`/pulls/${number}`);
    if (current.head.sha !== pr.head.sha) throw new Error("校验期间 PR 已更新");
    if ((await api("/git/trees/master")).sha !== master.sha)
      throw new Error("校验期间 master 已更新");
    console.log(`归档校验通过: artifact ${artifact.id}`);
  }
} else if (process.argv[2] === "promote") {
  const trigger = event.workflow_run;
  if (!trigger || (trigger.repository?.full_name && trigger.repository.full_name !== repository))
    throw new Error("缺少正式测量事件");
  const run = await api(`/actions/runs/${trigger.id}/attempts/${trigger.run_attempt}`);
  const provisional = {
    repository,
    runId: String(run.id),
    runAttempt: String(run.run_attempt),
    workflowId: run.workflow_id,
    commitSha: run.head_sha,
    artifactName: `benchmark-${run.id}-${run.run_attempt}`,
  };
  const artifact = await verifyProvenance(provisional, api);
  const files = await download(artifact);
  const manifest = validateBatch(files);
  if (
    manifest.runId !== provisional.runId ||
    manifest.runAttempt !== provisional.runAttempt ||
    manifest.repository !== repository
  )
    throw new Error("批次与触发 run 不一致");
  await verifyProvenance(manifest, api);
  const master = await api("/git/trees/master?recursive=1");
  if (master.truncated) throw new Error("无法完整读取 master");
  await checkInitialization(manifest, master);
  const destination = path.join(
    root,
    ".benchmark",
    manifest.suite,
    `${manifest.runId}-${manifest.runAttempt}`,
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination);
  for (const [name, content] of Object.entries(files))
    await fs.writeFile(path.join(destination, name), content, { flag: "wx" });
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `branch=codex/benchmark-${manifest.runId}-${manifest.runAttempt}\nartifact-id=${artifact.id}\narchive-path=.benchmark/${manifest.suite}/${manifest.runId}-${manifest.runAttempt}\n`,
    );
} else throw new Error("使用 check 或 promote");
