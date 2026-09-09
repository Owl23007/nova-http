import type { ResponseHeaders } from "../../message/response-sink";
import { getReasonPhrase } from "./status";

export type Http1ResponseBodyMode = "none" | "fixed" | "chunked" | "close-delimited";

export interface Http1ResponsePlan {
  readonly mode: Http1ResponseBodyMode;
  readonly contentLength: number | null;
  readonly headers: Map<string, string | readonly string[]>;
  readonly reusable: boolean;
}

export function resolveResponsePlan(
  method: string,
  version: string,
  requestClose: boolean,
  status: number,
  source: ResponseHeaders,
): Http1ResponsePlan {
  const headers = new Map(source);
  let reusable = !requestClose;
  let mode: Http1ResponseBodyMode;
  let contentLength: number | null = null;
  const bodyAllowed =
    method !== "HEAD" &&
    !(status >= 100 && status < 200) &&
    status !== 204 &&
    status !== 205 &&
    status !== 304;

  if (!bodyAllowed) {
    mode = "none";
    if (method !== "HEAD" && (status === 204 || (status >= 100 && status < 200))) {
      headers.delete("content-length");
    } else if (status === 205) {
      headers.set("content-length", "0");
    }
  } else {
    const length = headers.get("content-length");
    if (length !== undefined) {
      contentLength = parseContentLength(length);
      mode = "fixed";
    } else if (version === "1.1") {
      mode = "chunked";
      headers.set("transfer-encoding", "chunked");
    } else {
      mode = "close-delimited";
      reusable = false;
    }
  }

  if (hasHeaderToken(headers.get("connection"), "close")) reusable = false;
  if (!reusable) headers.set("connection", "close");
  else if (version === "1.0") headers.set("connection", "keep-alive");
  return { mode, contentLength, headers, reusable };
}

export function serializeResponseHead(
  version: string,
  status: number,
  headers: ResponseHeaders,
): Buffer {
  const parts = [`HTTP/${version} ${status} ${getReasonPhrase(status)}\r\n`];
  for (const [name, value] of headers) {
    if (Array.isArray(value)) for (const item of value) parts.push(`${name}: ${item}\r\n`);
    else parts.push(`${name}: ${value}\r\n`);
  }
  parts.push("\r\n");
  return Buffer.from(parts.join(""), "latin1");
}

export function encodeChunk(body: Buffer): readonly Buffer[] {
  return [
    Buffer.from(`${body.length.toString(16)}\r\n`, "ascii"),
    body,
    Buffer.from("\r\n", "ascii"),
  ];
}

export function encodeFinalChunk(): Buffer {
  return Buffer.from("0\r\n\r\n", "ascii");
}

function parseContentLength(value: string | readonly string[]): number {
  if (Array.isArray(value) || !/^(0|[1-9]\d*)$/.test(value as string))
    throw new TypeError("Invalid Content-Length response header");
  const length = Number(value);
  if (!Number.isSafeInteger(length))
    throw new RangeError("Content-Length exceeds the safe integer range");
  return length;
}

function hasHeaderToken(value: string | readonly string[] | undefined, token: string): boolean {
  if (value === undefined) return false;
  const values: readonly string[] = typeof value === "string" ? [value] : value;
  return values.some((item: string) =>
    item
      .split(",")
      .map((part: string) => part.trim().toLowerCase())
      .includes(token),
  );
}
