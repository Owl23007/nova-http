/**
 * bodyParser 中间件
 *
 * 解析 HTTP 请求体，支持：
 *   - application/json         → req.bodyParsed: any
 *   - application/x-www-form-urlencoded → req.bodyParsed: Record<string, string>
 *
 * 工作原理：
 *   请求体已在 ConnectionHandler 中通过 HTTP 状态机完整读取到 req.body（Buffer）。
 *   bodyParser 只负责按 Content-Type 解析该 Buffer，不需要再次处理流。
 *
 * 安全：
 *   - maxSize 限制（ContentHandler 层面已有 maxBodySize 防护，此处作为二次确认）
 *   - JSON.parse 使用 try/catch，解析失败返回 400
 *   - urlencoded 限制参数数量（防 HPP 攻击）
 *
 * 使用示例：
 *   app.use(bodyParser())                          // 默认配置
 *   app.use(bodyParser({ maxSize: 512 * 1024 }))   // 自定义 512KB 上限
 *   app.use(bodyParser({ types: ['json'] }))        // 仅解析 JSON
 */

import type { NovaRequest } from '../core/NovaRequest';
import type { NovaResponse } from '../core/NovaResponse';
import type { NextFunction } from '../core/MiddlewareChain';

// == 配置项

export interface BodyParserOptions {
  /** 最大请求体大小（字节），默认 1MB = 1048576 */
  maxSize?: number;
  /** 允许解析的 Content-Type 类型列表，默认 ['json', 'urlencoded'] */
  types?: Array<'json' | 'urlencoded'>;
  /** urlencoded 最大参数数量，防 HPP，默认 100 */
  maxParams?: number;
  /** 是否严格模式：JSON 顶层必须是对象或数组（而非原始值），默认 true */
  strict?: boolean;
}

// == 工厂函数

/**
 * 创建 bodyParser 中间件。
 */
export function bodyParser(options: BodyParserOptions = {}): (
  req: NovaRequest,
  res: NovaResponse,
  next: NextFunction,
) => void {
  const maxSize = options.maxSize ?? 1_048_576;
  const types = new Set(options.types ?? ['json', 'urlencoded']);
  const maxParams = options.maxParams ?? 100;
  const strict = options.strict ?? true;

  return (req: NovaRequest, res: NovaResponse, next: NextFunction): void => {
    // 若已解析则跳过（防止重复执行）
    if (req.bodyParsed !== undefined) {
      next();
      return;
    }

    // 无 body 的请求直接跳过
    if (req.body.length === 0) {
      next();
      return;
    }

    // 二次大小检查
    if (req.body.length > maxSize) {
      res.status(413).send('Payload Too Large');
      return;
    }

    const contentType = (req.headers.get('content-type') ?? '').toLowerCase();

    // == JSON 解析

    if (types.has('json') && contentType.includes('application/json')) {
      let text: string;
      try {
        text = req.body.toString('utf8');
      } catch {
        res.status(400).send('Invalid request body encoding');
        return;
      }

      try {
        const parsed = JSON.parse(text) as unknown;

        // 严格模式：顶层必须是对象或数组
        if (strict && (typeof parsed !== 'object' || parsed === null)) {
          res.status(400).send('JSON body must be an object or array');
          return;
        }

        req.bodyParsed = parsed;
        next();
        return;
      } catch {
        res.status(400).send('Invalid JSON body');
        return;
      }
    }

    // == URL-encoded 解析

    if (types.has('urlencoded') && contentType.includes('application/x-www-form-urlencoded')) {
      let text: string;
      try {
        text = req.body.toString('utf8');
      } catch {
        res.status(400).send('Invalid request body encoding');
        return;
      }

      try {
        const parsed: Record<string, string | string[]> = {};
        let paramCount = 0;

        for (const pair of text.split('&')) {
          if (!pair) continue;

          paramCount++;
          if (paramCount > maxParams) {
            res.status(400).send('Too many form parameters');
            return;
          }

          const eqIdx = pair.indexOf('=');
          let key: string;
          let value: string;

          if (eqIdx === -1) {
            key = safeDecodeURIComponent(pair);
            value = '';
          } else {
            key = safeDecodeURIComponent(pair.substring(0, eqIdx));
            value = safeDecodeURIComponent(pair.substring(eqIdx + 1));
          }

          if (!key) continue;

          // 同名参数处理：转为数组
          const existing = parsed[key];
          if (existing === undefined) {
            parsed[key] = value;
          } else if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            parsed[key] = [existing, value];
          }
        }

        req.bodyParsed = parsed;
        next();
        return;
      } catch {
        res.status(400).send('Invalid form body');
        return;
      }
    }

    // 不支持的 Content-Type，跳过（不报错，由路由自行处理 raw body）
    next();
  };
}

// == 工具函数

/**
 * 安全的 URL 解码：解码失败返回原始字符串，防止 malformed encoding 导致中间件崩溃。
 */
function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str.replace(/\+/g, ' '));
  } catch {
    return str;
  }
}
