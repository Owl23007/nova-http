/**
 * 归档布局工具，提供归档路径和文件解析功能
 *
 * @exports archiveBatchPath 生成归档批次路径
 * @exports parseArchiveFile 解析归档文件路径
 * @exports discoverArchiveBatches 发现归档批次
 */
import fs from "node:fs/promises";
import path from "node:path";

const batchPattern = /^[1-9]\d*-[1-9]\d*$/;
const releasePattern = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const suitePattern = /^[a-z0-9-]+-v\d+$/;

// 读取目录条目，返回 Dirent 对象数组
const directoryEntries = async (directory) =>
  fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

/**
 * 生成归档批次路径
 *
 * 格式为:
 *  -.benchmark/historical/<suite>/<batch>/
 *  -.benchmark/releases/<releaseTag>/<suite>/<batch>/
 **/
export function archiveBatchPath(
  { suite, runId, runAttempt, releaseTag: manifestReleaseTag },
  { releaseTag = manifestReleaseTag } = {},
) {
  if (!suitePattern.test(suite)) throw new Error("Invalid archive suite");
  const batch = `${runId}-${runAttempt}`;
  if (!batchPattern.test(batch)) throw new Error("Invalid archive batch");
  if (releaseTag !== undefined && !releasePattern.test(releaseTag))
    throw new Error("Invalid release tag");
  return releaseTag
    ? `.benchmark/releases/${releaseTag}/${suite}/${batch}/`
    : `.benchmark/historical/${suite}/${batch}/`;
}

// 解析归档文件路径，返回归档信息对象
export function parseArchiveFile(filename) {
  const normalized = filename.replaceAll("\\", "/");
  let match = normalized.match(
    /^\.benchmark\/historical\/([a-z0-9-]+-v\d+)\/([1-9]\d*-[1-9]\d*)\/([a-z0-9-]+\.json)$/,
  );
  if (match)
    return {
      collection: "historical",
      releaseTag: null,
      suite: match[1],
      batch: match[2],
      name: match[3],
    };
  match = normalized.match(
    /^\.benchmark\/releases\/(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\/([a-z0-9-]+-v\d+)\/([1-9]\d*-[1-9]\d*)\/([a-z0-9-]+\.json)$/,
  );
  if (match)
    return {
      collection: "release",
      releaseTag: match[1],
      suite: match[2],
      batch: match[3],
      name: match[4],
    };
  return null;
}

// 遍历归档目录，发现所有归档批次，返回归档信息对象数组
async function batchesIn(suiteDirectory, identity) {
  const entries = await directoryEntries(suiteDirectory);
  return entries
    .filter((entry) => entry.isDirectory() && batchPattern.test(entry.name))
    .map((entry) => ({
      ...identity,
      batch: entry.name,
      directory: path.join(suiteDirectory, entry.name),
    }));
}

// 发现归档批次，返回归档信息对象数组，按 collection/releaseTag/suite/batch 排序
export async function discoverArchiveBatches(root) {
  const archive = path.join(root, ".benchmark");
  const batches = [];

  for (const suite of await directoryEntries(path.join(archive, "historical")))
    if (suite.isDirectory() && suitePattern.test(suite.name))
      batches.push(
        ...(await batchesIn(path.join(archive, "historical", suite.name), {
          collection: "historical",
          releaseTag: null,
          suite: suite.name,
        })),
      );

  for (const release of await directoryEntries(path.join(archive, "releases"))) {
    if (!release.isDirectory() || !releasePattern.test(release.name)) continue;
    for (const suite of await directoryEntries(path.join(archive, "releases", release.name)))
      if (suite.isDirectory() && suitePattern.test(suite.name))
        batches.push(
          ...(await batchesIn(path.join(archive, "releases", release.name, suite.name), {
            collection: "release",
            releaseTag: release.name,
            suite: suite.name,
          })),
        );
  }

  // 第一版归档位于 .benchmark/<suite>/<batch>。它是只读兼容来源，新的写入不再使用该路径
  for (const suite of await directoryEntries(archive))
    if (suite.isDirectory() && suitePattern.test(suite.name))
      batches.push(
        ...(await batchesIn(path.join(archive, suite.name), {
          collection: "legacy",
          releaseTag: null,
          suite: suite.name,
        })),
      );

  return batches.toSorted((left, right) =>
    `${left.collection}/${left.releaseTag ?? ""}/${left.suite}/${left.batch}`.localeCompare(
      `${right.collection}/${right.releaseTag ?? ""}/${right.suite}/${right.batch}`,
    ),
  );
}
