import { http1Error, type Http1Error, type Http1ErrorPhase } from "./errors";
import { HeaderBlock, type HeaderField } from "../../message/headers";
import type { BodyPlan, HttpVersion, ParsedHead, RequestHead, RequestTarget } from "./types";
import type { ConnectionIntent } from "../../message/connection";
import type { SegmentedInput } from "./input";

export interface ParserLimits {
  maxRequestLineBytes: number;
  maxTargetBytes: number;
  maxHeaderLineBytes: number;
  maxHeadBytes: number;
  maxHeaderCount: number;
  maxChunkLineBytes: number;
}

export const DEFAULT_PARSER_LIMITS: ParserLimits = {
  maxRequestLineBytes: 16 * 1024,
  maxTargetBytes: 8 * 1024,
  maxHeaderLineBytes: 8 * 1024,
  maxHeadBytes: 64 * 1024,
  maxHeaderCount: 200,
  maxChunkLineBytes: 1024,
};

export interface HeadScanState {
  scanOffset: number;
  lineStart: number;
  lineNumber: number;
  lastByte: number | null;
}

export type HeadScanResult =
  | { readonly type: "need-data" }
  | { readonly type: "complete"; readonly length: number }
  | { readonly type: "error"; readonly error: Http1Error };

export function createHeadScanState(): HeadScanState {
  return { scanOffset: 0, lineStart: 0, lineNumber: 0, lastByte: null };
}

/** 单调扫描严格 CRLF，每个已到达字节最多检查一次 */
export function scanHead(
  input: SegmentedInput,
  state: HeadScanState,
  limits: ParserLimits,
  trailer = false,
): HeadScanResult {
  let result: HeadScanResult | undefined;
  input.visitSegments(state.scanOffset, input.available - state.scanOffset, (segment, absolute) => {
    let local = 0;
    while (local < segment.length) {
      const lf = segment.indexOf(0x0a, local);
      if (lf === -1) {
        state.scanOffset = absolute + segment.length;
        if (segment.length > 0) state.lastByte = segment[segment.length - 1];
        return;
      }

      const lfOffset = absolute + lf;
      const previousByte = lf > 0 ? segment[lf - 1] : state.lastByte;
      if (previousByte !== 0x0d) {
        result = {
          type: "error",
          error: http1Error(
            "syntax",
            "HPE_LF_EXPECTED_CR",
            400,
            trailer ? "trailers" : state.lineNumber === 0 ? "request-line" : "headers",
            "HTTP lines must end with CRLF",
          ),
        };
        return false;
      }

      const lineBytes = lfOffset - state.lineStart - 1;
      const phase: Http1ErrorPhase = trailer
        ? "trailers"
        : state.lineNumber === 0
          ? "request-line"
          : "headers";
      const lineLimit =
        !trailer && state.lineNumber === 0 ? limits.maxRequestLineBytes : limits.maxHeaderLineBytes;
      if (lineBytes > lineLimit) {
        result = {
          type: "error",
          error: http1Error(
            "limit",
            phase === "request-line" ? "HPE_REQUEST_LINE_TOO_LONG" : "HPE_HEADER_LINE_TOO_LONG",
            phase === "request-line" ? 414 : 431,
            phase,
            phase === "request-line" ? "Request line is too long" : "Header field line is too long",
          ),
        };
        return false;
      }

      state.scanOffset = lfOffset + 1;
      state.lastByte = 0x0a;
      state.lineStart = state.scanOffset;
      state.lineNumber++;
      local = lf + 1;
      if (lineBytes === 0) {
        if (state.scanOffset > limits.maxHeadBytes) {
          result = {
            type: "error",
            error: http1Error(
              "limit",
              "HPE_HEAD_TOO_LARGE",
              431,
              trailer ? "trailers" : "headers",
              trailer ? "Trailer section is too large" : "Request head is too large",
            ),
          };
          return false;
        }
        result = { type: "complete", length: state.scanOffset };
        return false;
      }
    }
    if (segment.length > 0) state.lastByte = segment[segment.length - 1];
    return true;
  });

  if (result !== undefined) return result;
  if (input.available > limits.maxHeadBytes) {
    return {
      type: "error",
      error: http1Error(
        "limit",
        "HPE_HEAD_TOO_LARGE",
        431,
        trailer ? "trailers" : "headers",
        trailer ? "Trailer section is too large" : "Request head is too large",
      ),
    };
  }

  const pendingBytes = input.available - state.lineStart;
  const pendingLimit =
    !trailer && state.lineNumber === 0 ? limits.maxRequestLineBytes : limits.maxHeaderLineBytes;
  if (pendingBytes > pendingLimit + 1) {
    const requestLine = !trailer && state.lineNumber === 0;
    return {
      type: "error",
      error: http1Error(
        "limit",
        requestLine ? "HPE_REQUEST_LINE_TOO_LONG" : "HPE_HEADER_LINE_TOO_LONG",
        requestLine ? 414 : 431,
        requestLine ? "request-line" : trailer ? "trailers" : "headers",
        requestLine ? "Request line is too long" : "Header field line is too long",
      ),
    };
  }
  return { type: "need-data" };
}

export function takeScannedBlock(input: SegmentedInput, length: number): Buffer {
  const front = input.front();
  if (front !== null && front.length >= length) {
    const block = front.subarray(0, length);
    input.consume(length);
    return block;
  }
  return input.copyPrefix(length);
}

export function parseHead(buffer: Buffer, limits: ParserLimits): ParsedHead | Http1Error {
  const requestLineEnd = buffer.indexOf("\r\n", 0, "latin1");
  if (requestLineEnd < 0) {
    return http1Error(
      "syntax",
      "HPE_INVALID_REQUEST_LINE",
      400,
      "request-line",
      "Incomplete request line",
    );
  }

  const firstSpace = buffer.indexOf(0x20, 0);
  const secondSpace = firstSpace < 0 ? -1 : buffer.indexOf(0x20, firstSpace + 1);
  if (
    firstSpace <= 0 ||
    secondSpace <= firstSpace + 1 ||
    secondSpace >= requestLineEnd - 1 ||
    (() => {
      const thirdSpace = buffer.indexOf(0x20, secondSpace + 1);
      return thirdSpace !== -1 && thirdSpace < requestLineEnd;
    })()
  ) {
    return http1Error(
      "syntax",
      "HPE_INVALID_REQUEST_LINE",
      400,
      "request-line",
      "Invalid request line",
    );
  }

  if (!isToken(buffer, 0, firstSpace)) {
    return http1Error(
      "syntax",
      "HPE_INVALID_METHOD",
      400,
      "request-line",
      "Invalid HTTP method token",
    );
  }
  const targetLength = secondSpace - firstSpace - 1;
  if (targetLength > limits.maxTargetBytes) {
    return http1Error(
      "limit",
      "HPE_TARGET_TOO_LONG",
      414,
      "request-line",
      "Request target is too long",
    );
  }
  if (!isVisibleAscii(buffer, firstSpace + 1, secondSpace)) {
    return http1Error(
      "syntax",
      "HPE_INVALID_TARGET",
      400,
      "request-line",
      "Request target contains invalid bytes",
    );
  }

  const method = buffer.toString("latin1", 0, firstSpace);
  const rawTarget = buffer.toString("latin1", firstSpace + 1, secondSpace);
  const versionText = buffer.toString("latin1", secondSpace + 1, requestLineEnd);
  let version: HttpVersion;
  if (versionText === "HTTP/1.1") version = "1.1";
  else if (versionText === "HTTP/1.0") version = "1.0";
  else {
    return http1Error(
      "unsupported",
      "HPE_UNSUPPORTED_VERSION",
      505,
      "request-line",
      "HTTP version is not supported",
    );
  }

  const target = resolveTarget(method, rawTarget);
  if (isHttp1Error(target)) return target;
  const headers = parseFieldLines(buffer, requestLineEnd + 2, buffer.length - 2, limits, "headers");
  if (isHttp1Error(headers)) return headers;

  const hosts = headers.getAll("host");
  if (
    hosts.length > 1 ||
    (version === "1.1" && hosts.length !== 1) ||
    (hosts.length === 1 && !isValidHostField(hosts[0]))
  ) {
    return http1Error(
      "syntax",
      "HPE_INVALID_HOST",
      400,
      "headers",
      "HTTP/1.1 requires exactly one non-empty Host field",
    );
  }
  return { method, rawTarget, target, version, headers };
}

export function parseTrailers(buffer: Buffer, limits: ParserLimits): HeaderBlock | Http1Error {
  const trailers = parseFieldLines(buffer, 0, buffer.length - 2, limits, "trailers");
  if (isHttp1Error(trailers)) return trailers;
  const forbidden = [
    "authorization",
    "connection",
    "content-length",
    "expect",
    "host",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ];
  for (const name of forbidden) {
    if (trailers.has(name)) {
      return http1Error(
        "framing",
        "HPE_FORBIDDEN_TRAILER",
        400,
        "trailers",
        `Field ${name} is not allowed in trailers`,
      );
    }
  }
  return trailers;
}

export function resolveFraming(head: ParsedHead): BodyPlan | Http1Error {
  const transferEncodings = head.headers.getAll("transfer-encoding");
  const contentLengths = head.headers.getAll("content-length");
  if (transferEncodings.length > 0 && contentLengths.length > 0) {
    return http1Error(
      "framing",
      "HPE_TE_CL_CONFLICT",
      400,
      "headers",
      "Transfer-Encoding and Content-Length cannot be combined",
    );
  }

  if (transferEncodings.length > 0) {
    const rawCodings = splitFramingValues(transferEncodings);
    if (rawCodings === null) {
      return http1Error(
        "framing",
        "HPE_INVALID_TRANSFER_ENCODING",
        400,
        "headers",
        "Invalid Transfer-Encoding",
      );
    }
    const codings = rawCodings.map((value) => asciiLower(value));
    if (codings.some((coding) => !isTokenString(coding))) {
      return http1Error(
        "framing",
        "HPE_INVALID_TRANSFER_ENCODING",
        400,
        "headers",
        "Invalid Transfer-Encoding",
      );
    }
    if (head.version !== "1.1") {
      return http1Error(
        "framing",
        "HPE_INVALID_TRANSFER_ENCODING",
        400,
        "headers",
        "Transfer-Encoding requires HTTP/1.1",
      );
    }
    if (codings[codings.length - 1] !== "chunked") {
      return http1Error(
        "framing",
        "HPE_FINAL_TRANSFER_CODING",
        400,
        "headers",
        "The final request transfer coding must be chunked",
      );
    }
    if (codings.length !== 1) {
      return http1Error(
        "unsupported",
        "HPE_UNSUPPORTED_TRANSFER_CODING",
        501,
        "headers",
        "Transfer codings other than chunked are not supported",
      );
    }
    return { type: "chunked" };
  }

  if (contentLengths.length > 0) {
    const values = splitFramingValues(contentLengths);
    if (values === null) {
      return http1Error(
        "framing",
        "HPE_INVALID_CONTENT_LENGTH",
        400,
        "headers",
        "Invalid Content-Length",
      );
    }
    let length: number | undefined;
    for (const value of values) {
      if (!isDigits(value)) {
        return http1Error(
          "framing",
          "HPE_INVALID_CONTENT_LENGTH",
          400,
          "headers",
          "Invalid Content-Length",
        );
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || (length !== undefined && parsed !== length)) {
        return http1Error(
          "framing",
          "HPE_INVALID_CONTENT_LENGTH",
          400,
          "headers",
          "Content-Length values differ or exceed the safe integer range",
        );
      }
      length = parsed;
    }
    return length === 0 ? { type: "none" } : { type: "fixed", length: length! };
  }
  return { type: "none" };
}

export function resolveConnectionIntent(head: ParsedHead): ConnectionIntent {
  const connectionTokens = splitCommaValues(head.headers.getAll("connection")).map(asciiLower);
  const close =
    head.version === "1.1"
      ? connectionTokens.includes("close")
      : !connectionTokens.includes("keep-alive");
  const upgrade = connectionTokens.includes("upgrade") ? head.headers.get("upgrade") : undefined;
  return { close, connect: head.method === "CONNECT", ...(upgrade ? { upgrade } : {}) };
}

export function buildRequestHead(head: ParsedHead): RequestHead | Http1Error {
  const bodyPlan = resolveFraming(head);
  if (isHttp1Error(bodyPlan)) return bodyPlan;
  return { ...head, bodyPlan, connection: resolveConnectionIntent(head) };
}

export function parseChunkSize(line: Buffer): number | Http1Error {
  const semicolon = line.indexOf(0x3b);
  const end = semicolon === -1 ? line.length : semicolon;
  if (end === 0)
    return http1Error("syntax", "HPE_INVALID_CHUNK_SIZE", 400, "body", "Chunk size is empty");
  let size = 0;
  for (let i = 0; i < end; i++) {
    const nibble = hexValue(line[i]);
    if (nibble < 0)
      return http1Error(
        "syntax",
        "HPE_INVALID_CHUNK_SIZE",
        400,
        "body",
        "Chunk size is not valid hexadecimal",
      );
    size = size * 16 + nibble;
    if (!Number.isSafeInteger(size))
      return http1Error(
        "limit",
        "HPE_CHUNK_SIZE_OVERFLOW",
        413,
        "body",
        "Chunk size exceeds the safe integer range",
      );
  }
  return size;
}

export function isHttp1Error(value: unknown): value is Http1Error {
  return typeof value === "object" && value !== null && "fatal" in value;
}

function parseFieldLines(
  buffer: Buffer,
  start: number,
  end: number,
  limits: ParserLimits,
  phase: "headers" | "trailers",
): HeaderBlock | Http1Error {
  const fields: HeaderField[] = [];
  let lineStart = start;
  while (lineStart < end) {
    const lineEnd = buffer.indexOf("\r\n", lineStart, "latin1");
    if (lineEnd < 0 || lineEnd > end) {
      return http1Error("syntax", "HPE_INVALID_HEADER", 400, phase, "Incomplete header field line");
    }
    if (buffer[lineStart] === 0x20 || buffer[lineStart] === 0x09) {
      return http1Error(
        "syntax",
        "HPE_OBSOLETE_FOLD",
        400,
        phase,
        "Obsolete line folding is not accepted",
      );
    }
    const colon = buffer.indexOf(0x3a, lineStart);
    if (colon <= lineStart || colon >= lineEnd || !isToken(buffer, lineStart, colon)) {
      return http1Error(
        "syntax",
        "HPE_INVALID_HEADER_NAME",
        400,
        phase,
        "Invalid header field name",
      );
    }
    let valueStart = colon + 1;
    let valueEnd = lineEnd;
    while (valueStart < valueEnd && isOws(buffer[valueStart])) valueStart++;
    while (valueEnd > valueStart && isOws(buffer[valueEnd - 1])) valueEnd--;
    for (let i = valueStart; i < valueEnd; i++) {
      const byte = buffer[i];
      if ((byte < 0x20 && byte !== 0x09) || byte === 0x7f) {
        return http1Error(
          "syntax",
          "HPE_INVALID_HEADER_VALUE",
          400,
          phase,
          "Header field value contains invalid control bytes",
        );
      }
    }
    fields.push({
      name: asciiLower(buffer.toString("latin1", lineStart, colon)),
      value: buffer.toString("latin1", valueStart, valueEnd),
    });
    if (fields.length > limits.maxHeaderCount) {
      return http1Error("limit", "HPE_TOO_MANY_HEADERS", 431, phase, "Too many header fields");
    }
    lineStart = lineEnd + 2;
  }
  return new HeaderBlock(fields);
}

function resolveTarget(method: string, raw: string): RequestTarget | Http1Error {
  if (raw.includes("#"))
    return http1Error(
      "syntax",
      "HPE_INVALID_TARGET",
      400,
      "request-line",
      "Request target cannot contain a fragment",
    );
  if (raw === "*") {
    return method === "OPTIONS"
      ? { form: "asterisk", raw: "*" }
      : http1Error(
          "syntax",
          "HPE_INVALID_TARGET_FORM",
          400,
          "request-line",
          "Asterisk-form is only valid for OPTIONS",
        );
  }
  if (method === "CONNECT") {
    if (!isAuthorityForm(raw))
      return http1Error(
        "syntax",
        "HPE_INVALID_TARGET_FORM",
        400,
        "request-line",
        "CONNECT requires authority-form",
      );
    return { form: "authority", raw };
  }
  if (raw.startsWith("/")) return { form: "origin", raw };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) return { form: "absolute", raw };
  return http1Error(
    "syntax",
    "HPE_INVALID_TARGET_FORM",
    400,
    "request-line",
    "Invalid request target form",
  );
}

function isAuthorityForm(value: string): boolean {
  if (value.length === 0 || value.includes("/") || value.includes("?") || value.includes("@"))
    return false;
  if (value.startsWith("[")) return /^\[[0-9A-Fa-f:.]+\]:[0-9]+$/.test(value);
  return /^[^:\s]+:[0-9]+$/.test(value);
}

function isValidHostField(value: string): boolean {
  if (value.length === 0) return false;
  let hostEnd = value.length;
  if (value.startsWith("[")) {
    const closing = value.indexOf("]");
    if (closing <= 1) return false;
    for (let i = 1; i < closing; i++) {
      const code = value.charCodeAt(i);
      const valid =
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        ":.-_~!$&'()*+,;=".includes(value[i]);
      if (!valid) return false;
    }
    hostEnd = closing + 1;
  } else {
    const colon = value.lastIndexOf(":");
    hostEnd = colon === -1 ? value.length : colon;
    if (value.indexOf(":") !== colon) return false;
    for (let i = 0; i < hostEnd; i++) {
      const code = value.charCodeAt(i);
      const valid =
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        "-._~%!$&'()*+,;=".includes(value[i]);
      if (!valid) return false;
    }
  }
  if (hostEnd === value.length) return true;
  if (value[hostEnd] !== ":" || hostEnd + 1 === value.length) return false;
  return isDigits(value.substring(hostEnd + 1));
}

function splitCommaValues(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const trimmed = trimOwsString(part);
      if (trimmed.length > 0) result.push(trimmed);
    }
  }
  return result;
}

function splitFramingValues(values: readonly string[]): string[] | null {
  const result: string[] = [];
  for (const value of values) {
    const parts = value.split(",");
    for (const part of parts) {
      const trimmed = trimOwsString(part);
      if (trimmed.length === 0) return null;
      result.push(trimmed);
    }
  }
  return result.length === 0 ? null : result;
}

function trimOwsString(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value.charCodeAt(start) === 0x20 || value.charCodeAt(start) === 0x09))
    start++;
  while (end > start && (value.charCodeAt(end - 1) === 0x20 || value.charCodeAt(end - 1) === 0x09))
    end--;
  return value.substring(start, end);
}

function isToken(buffer: Buffer, start: number, end: number): boolean {
  if (start >= end) return false;
  for (let i = start; i < end; i++) if (!isTokenByte(buffer[i])) return false;
  return true;
}

function isTokenString(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) if (!isTokenByte(value.charCodeAt(i))) return false;
  return true;
}

function isTokenByte(byte: number): boolean {
  if (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a)
  )
    return true;
  return (
    byte === 0x21 ||
    byte === 0x23 ||
    byte === 0x24 ||
    byte === 0x25 ||
    byte === 0x26 ||
    byte === 0x27 ||
    byte === 0x2a ||
    byte === 0x2b ||
    byte === 0x2d ||
    byte === 0x2e ||
    byte === 0x5e ||
    byte === 0x5f ||
    byte === 0x60 ||
    byte === 0x7c ||
    byte === 0x7e
  );
}

function isVisibleAscii(buffer: Buffer, start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (buffer[i] < 0x21 || buffer[i] > 0x7e) return false;
  return true;
}

function isOws(byte: number): boolean {
  return byte === 0x20 || byte === 0x09;
}

function asciiLower(value: string): string {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    result += String.fromCharCode(code >= 0x41 && code <= 0x5a ? code + 0x20 : code);
  }
  return result;
}

function isDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return false;
  }
  return true;
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}
