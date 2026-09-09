import { createReadStream } from "fs";
import { stat } from "fs/promises";
import type { NovaRequest } from "../core/request";
import type { NovaResponse } from "../core/response";
import { getMimeType } from "./mime";
import { parseRange } from "./range";

export interface SendFileOptions {
  etag?: boolean;
  lastModified?: boolean;
}

/** Filesystem adapter for serving a file through the application response API. */
export async function sendFile(
  req: NovaRequest,
  res: NovaResponse,
  filePath: string,
  options: SendFileOptions = {},
): Promise<void> {
  let stats;
  try {
    stats = await stat(filePath);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    res
      .status(fileError.code === "ENOENT" ? 404 : 500)
      .send(fileError.code === "ENOENT" ? "Not Found" : "Internal Server Error");
    await res._waitForFinish();
    return;
  }
  if (!stats.isFile()) {
    res.status(404).send("Not Found");
    await res._waitForFinish();
    return;
  }

  const fileSize = stats.size;
  const etag = `"${stats.mtimeMs.toString(36)}-${stats.size.toString(36)}"`;
  const lastModified = stats.mtime.toUTCString();
  const useEtag = options.etag ?? true;
  const useLastModified = options.lastModified ?? true;
  if (
    (useEtag && req.headers.get("if-none-match") === etag) ||
    (useLastModified && req.headers.get("if-modified-since") === lastModified)
  ) {
    res.status(304);
    if (useEtag) res.setHeader("etag", etag);
    if (useLastModified) res.setHeader("last-modified", lastModified);
    await res.end();
    return;
  }

  const rangeHeader = req.headers.get("range");
  let start: number | undefined;
  let end: number | undefined;
  let contentLength = fileSize;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, fileSize);
    if (range === null) {
      res.status(416).setHeader("content-range", `bytes */${fileSize}`);
      await res.end();
      return;
    }
    res.status(206).setHeader("content-range", `bytes ${range.start}-${range.end}/${fileSize}`);
    start = range.start;
    end = range.end;
    contentLength = range.end - range.start + 1;
  }
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("content-type", getMimeType(filePath));
  res.setHeader("content-length", String(contentLength));
  if (useEtag) res.setHeader("etag", etag);
  if (useLastModified) res.setHeader("last-modified", lastModified);
  if (req.method === "HEAD") {
    await res.end();
    return;
  }
  await res.stream(createReadStream(filePath, { start, end, highWaterMark: 64 * 1024 }));
}
