/**
 * 归档工具，提供 PR 校验和批次发布功能
 *
 * @argv check 校验 PR 中的归档数据
 * @argv promote 发布已验证的归档批次到 master
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBatch, validatePullRequest } from "./archive.js";
import { archiveBatchPath, parseArchiveFile } from "./archive-layout.js";
import { writeArchiveReport } from "./archive-report.js";
import { createGitHubAPI, loadVerifiedBatch } from "./remote.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const repository = process.env.GITHUB_REPOSITORY;
const api = createGitHubAPI(repository, process.env.GITHUB_TOKEN);
const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"));

// 归档 PR 校验和批次发布
if (process.argv[2] === "check") {
  const number = event.pull_request?.number;
  if (!Number.isInteger(number)) throw new Error("Missing pull request identity");
  const pr = await api("/pulls/" + number);
  const changes = [];
  for (let page = 1; page <= 30; page++) {
    const chunk = await api("/pulls/" + number + "/files?per_page=100&page=" + page);
    changes.push(...chunk);
    if (chunk.length < 100) break;
  }
  if (changes.length !== pr.changed_files)
    throw new Error("Could not read the complete pull request file list");
  if (
    !changes.some(
      (c) => c.filename.startsWith(".benchmark/") || c.previous_filename?.startsWith(".benchmark/"),
    )
  ) {
    console.log("Pull request does not modify benchmark archives");
  } else {
    const groups = new Map();
    for (const change of changes) {
      const location = parseArchiveFile(change.filename);
      if (change.status !== "added" || !location)
        throw new Error("Archive changes must only add JSON files through an archive pull request");
      const directory = path.posix.dirname(change.filename);
      if (!groups.has(directory)) groups.set(directory, { files: {}, changes: [], location });
      const group = groups.get(directory);
      if (
        group.location.collection !== location.collection ||
        group.location.releaseTag !== location.releaseTag ||
        group.location.suite !== location.suite ||
        group.location.batch !== location.batch
      )
        throw new Error("Archive path identities do not match");
      const blob = await api("/git/blobs/" + change.sha);
      if (blob.size > 10_000_000 || blob.encoding !== "base64")
        throw new Error("Invalid file size or encoding");
      const name = path.posix.basename(change.filename);
      if (Object.hasOwn(group.files, name)) throw new Error("Duplicate file");
      group.files[name] = Buffer.from(blob.content, "base64").toString("utf8");
      group.changes.push(change);
    }
    if (groups.size !== 1) throw new Error("An archive must contain exactly one batch");
    const batches = [...groups.values()].map((group) => ({
      ...group,
      manifest: validateBatch(group.files),
    }));
    const master = await api("/git/trees/master?recursive=1");
    const head = await api("/git/trees/" + pr.head.sha + "?recursive=1");
    if (master.truncated || head.truncated) throw new Error("Could not read the complete Git tree");
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
        throw new Error("Symbolic links and special files are not allowed");
    for (const batch of batches) {
      const manifest = batch.manifest;
      if (manifest.repository !== repository) throw new Error("Repository does not match");
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
        batch.location,
      );
    }
    if ((await api("/pulls/" + number)).head.sha !== pr.head.sha)
      throw new Error("Pull request changed during validation");
    if ((await api("/git/trees/master")).sha !== master.sha)
      throw new Error("Master changed during validation");
    console.log(`Archive validation passed: ${batches.length} batch(es)`);
  }
} else if (process.argv[2] === "promote") {
  const source = {
    runId: process.env.BENCH_SOURCE_RUN_ID,
    runAttempt: process.env.BENCH_SOURCE_RUN_ATTEMPT,
  };
  const releaseTag = process.env.BENCH_RELEASE_TAG || null;
  if (
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    event.repository?.full_name !== repository ||
    !source ||
    !/^[1-9]\d*$/.test(String(source.runId)) ||
    !/^[1-9]\d*$/.test(String(source.runAttempt))
  )
    throw new Error("Missing official measurement event");
  const current = await loadVerifiedBatch(
    repository,
    String(source.runId),
    String(source.runAttempt),
    api,
  );
  const master = await api("/git/trees/master?recursive=1");
  if (master.truncated) throw new Error("Could not read the complete master tree");
  const { manifest, files, artifact } = current;
  const prefix = archiveBatchPath(manifest, releaseTag ? { releaseTag } : {});
  if (master.tree.some((entry) => entry.path.startsWith(prefix)))
    throw new Error("Batch already exists");
  const destination = path.join(root, prefix);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination);
  for (const [name, content] of Object.entries(files))
    await fs.writeFile(path.join(destination, name), content, { flag: "wx" });
  const reportPath = path.join(
    process.env.RUNNER_TEMP ?? path.join(root, ".tmp"),
    `benchmark-archive-${manifest.runId}-${manifest.runAttempt}.md`,
  );
  await writeArchiveReport(destination, {
    artifactId: artifact.id,
    archivePath: prefix,
    outputPath: reportPath,
  });
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `ready=true\nbranch=benchmark/${releaseTag ? `${releaseTag}-` : ""}${manifest.runId}-${manifest.runAttempt}\nartifact-id=${artifact.id}\narchive-path=${prefix}\nbody-path=${reportPath}\n`,
    );
} else throw new Error("Use either check or promote");
