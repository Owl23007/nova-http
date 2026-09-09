/**
 * bodyParser 中间件
 *
 * 解析 HTTP 请求体，支持：
 *   - application/json         → req.context.bodyParserData.body: unknown
 *   - application/x-www-form-urlencoded → req.context.bodyParserData.body: Record<string, string>
 *
 * 工作原理：
 *   bodyParser 通过 req.buffer() 显式物化流式请求体
 *
 * 安全：
 *   - maxSize 限制作为连接层 body policy 之后的物化上限
 *   - JSON.parse 使用 try/catch，解析失败返回 400
 *   - urlencoded 限制参数数量（防 HPP 攻击）
 *
 * 使用示例：
 *   app.use(bodyParser())                          // 默认配置
 *   app.use(bodyParser({ maxSize: 512 * 1024 }))   // 自定义 512KB 上限
 *   app.use(bodyParser({ types: ['json'] }))        // 仅解析 JSON
 */

import type { MiddlewareContext, NextFunction, NovaRequest, NovaResponse } from "../core";

export interface BodyParserData {
  body: unknown;
  contentType: string;
}

export interface BodyParsedContext extends BodyParserData {
  req: NovaRequest;
  res: NovaResponse;
}

declare module "../core/hooks" {
  interface HookEvents {
    "bodyParser:parsed": BodyParsedContext;
  }
}

declare module "../core/request" {
  interface RequestLocals {
    bodyParserData?: BodyParserData;
  }
}

// 配置项

export interface BodyParserOptions {
  /** 最大请求体大小（字节），默认 1MB = 1048576 */
  maxSize?: number;
  /** 允许解析的 Content-Type 类型列表，默认 ['json', 'urlencoded'] */
  types?: Array<"json" | "urlencoded">;
  /** urlencoded 最大参数数量，防 HPP，默认 100 */
  maxParams?: number;
  /** 是否严格模式：JSON 顶层必须是对象或数组（而非原始值），默认 true */
  strict?: boolean;
}

interface BodyParserConfig {
  maxSize: number;
  types: Set<"json" | "urlencoded">;
  maxParams: number;
  strict: boolean;
}

type ParsedFormBody = Record<string, string | string[]>;

/**
 * 创建 bodyParser 中间件
 *
 * @param options - 请求体解析配置
 * @returns 可传入 `app.use()` 的中间件
 */
export function bodyParser(
  options: BodyParserOptions = {},
): (req: NovaRequest, res: NovaResponse, next: NextFunction) => Promise<void> {
  const config = normalizeBodyParserOptions(options);

  return async function (
    this: MiddlewareContext | void,
    req: NovaRequest,
    res: NovaResponse,
    next: NextFunction,
  ): Promise<void> {
    if (req.context.bodyParserData !== undefined) {
      next();
      return;
    }

    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    const parser = selectBodyParser(contentType, config);

    if (parser === null) {
      next();
      return;
    }

    let raw: Buffer;
    try {
      raw = await req.buffer({ maxSize: config.maxSize });
    } catch (error: unknown) {
      if (error instanceof RangeError) {
        res.status(413).send("Payload Too Large");
        return;
      }
      throw error;
    }
    if (raw.length === 0) {
      next();
      return;
    }

    const text = readUtf8Body(raw);
    if (text === null) {
      res.status(400).send("Invalid request body encoding");
      return;
    }

    const result = parser(text);
    if (!result.ok) {
      res.status(400).send(result.message);
      return;
    }

    const data: BodyParserData = {
      body: result.value,
      contentType,
    };
    req.context.bodyParserData = data;
    this?.hooks.emitHook("bodyParser:parsed", {
      req,
      res,
      ...data,
    });
    next();
  };
}

/**
 * 合并 bodyParser 默认配置
 */
function normalizeBodyParserOptions(options: BodyParserOptions): BodyParserConfig {
  return {
    maxSize: options.maxSize ?? 1_048_576,
    types: new Set(options.types ?? ["json", "urlencoded"]),
    maxParams: options.maxParams ?? 100,
    strict: options.strict ?? true,
  };
}

/**
 * 根据 Content-Type 选择请求体解析器
 */
function selectBodyParser(
  contentType: string,
  config: BodyParserConfig,
): ((text: string) => ParseBodyResult) | null {
  if (config.types.has("json") && contentType.includes("application/json")) {
    return (text) => parseJsonBody(text, config.strict);
  }

  if (config.types.has("urlencoded") && contentType.includes("application/x-www-form-urlencoded")) {
    return (text) => parseUrlEncodedBody(text, config.maxParams);
  }

  return null;
}

type ParseBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; message: "Invalid JSON body" | "JSON body must be an object or array" }
  | { ok: false; message: "Too many form parameters" | "Invalid form body" };

/**
 * 将原始请求体读取为 UTF-8 字符串
 */
function readUtf8Body(body: Buffer): string | null {
  try {
    return body.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * 解析 JSON 请求体
 */
function parseJsonBody(text: string, strict: boolean): ParseBodyResult {
  try {
    const parsed = JSON.parse(text) as unknown;

    if (strict && (typeof parsed !== "object" || parsed === null)) {
      return { ok: false, message: "JSON body must be an object or array" };
    }

    return { ok: true, value: parsed };
  } catch {
    return { ok: false, message: "Invalid JSON body" };
  }
}

/**
 * 解析 `application/x-www-form-urlencoded` 请求体
 */
function parseUrlEncodedBody(text: string, maxParams: number): ParseBodyResult {
  try {
    const parsed: ParsedFormBody = {};
    let paramCount = 0;

    for (const pair of text.split("&")) {
      if (!pair) continue;

      paramCount++;
      if (paramCount > maxParams) {
        return { ok: false, message: "Too many form parameters" };
      }

      const { key, value } = parseFormPair(pair);
      if (!key) continue;

      appendFormValue(parsed, key, value);
    }

    return { ok: true, value: parsed };
  } catch {
    return { ok: false, message: "Invalid form body" };
  }
}

/**
 * 解析单个表单键值对
 */
function parseFormPair(pair: string): { key: string; value: string } {
  const eqIdx = pair.indexOf("=");

  if (eqIdx === -1) {
    return {
      key: safeDecodeURIComponent(pair),
      value: "",
    };
  }

  return {
    key: safeDecodeURIComponent(pair.substring(0, eqIdx)),
    value: safeDecodeURIComponent(pair.substring(eqIdx + 1)),
  };
}

/**
 * 追加表单字段。同名字段会自动合并为数组
 */
function appendFormValue(target: ParsedFormBody, key: string, value: string): void {
  const existing = target[key];
  if (existing === undefined) {
    target[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    target[key] = [existing, value];
  }
}

/**
 * 安全的 URL 解码：解码失败返回原始字符串，防止 malformed encoding 导致中间件崩溃
 */
function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str.replace(/\+/g, " "));
  } catch {
    return str;
  }
}
