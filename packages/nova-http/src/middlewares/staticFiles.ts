/**
 * staticFiles 中间件
 *
 * 功能：
 *   - 静态文件服务（内置 50+ MIME 类型映射，来自 NovaResponse.getMimeType）
 *   - ETag 缓存验证（基于 mtime + size，非加密，高性能）
 *   - Last-Modified / If-Modified-Since 条件请求
 *   - Range 请求支持（206 Partial Content，通过 res.sendFile 实现）
 *   - 目录访问 → index.html fallback
 *   - 路径遍历防护：path.resolve + startsWith 双重验证
 *   - dotfile 拒绝（默认不暴露 .env .git 等隐藏文件）
 *
 * 使用示例：
 *   app.use(staticFiles('./public'))
 *   app.use('/assets', staticFiles('./dist', { maxAge: 86400 }))
 *
 * 安全说明：
 *   仅处理 GET 和 HEAD 请求；所有路径通过 path.resolve 后验证以 root 开头，
 *   防止 ../../etc/passwd 等路径遍历攻击。
 */

import { stat } from 'fs';
import { join, resolve, normalize, basename, sep } from 'path';
import type { NovaRequest } from '../core/NovaRequest';
import type { NovaResponse } from '../core/NovaResponse';
import type { NextFunction } from '../core/MiddlewareChain';

// == 配置项

export interface StaticFilesOptions {
  /** Cache-Control max-age 秒数，默认 3600 (1小时)，设为 0 时发送 no-cache */
  maxAge?: number;
  /** 目录访问时尝试的默认文件名，默认 'index.html'，设为 false 禁用 */
  index?: string | false;
  /**
   * dotfile（以 . 开头的文件/目录）处理策略：
   *   - 'ignore'（默认）：返回 404，不暴露存在性
   *   - 'allow'：允许访问
   *   - 'deny'：返回 403
   */
  dotFiles?: 'ignore' | 'allow' | 'deny';
  /** 是否启用 ETag，默认 true */
  etag?: boolean;
  /** 是否启用 Last-Modified，默认 true */
  lastModified?: boolean;
}

// == 工厂函数

/**
 * 创建静态文件服务中间件。
 * @param root 静态文件根目录（相对或绝对路径）
 * @param options 配置项
 */
export function staticFiles(
  root: string,
  options: StaticFilesOptions = {},
): (req: NovaRequest, res: NovaResponse, next: NextFunction) => void {
  const resolvedRoot = resolve(normalize(root));

  const maxAge = options.maxAge ?? 3600;
  const indexFile = options.index === false ? false : (options.index ?? 'index.html');
  const dotFiles = options.dotFiles ?? 'ignore';

  return (req: NovaRequest, res: NovaResponse, next: NextFunction): void => {
    // 仅处理 GET 和 HEAD 请求
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    // 解码请求路径
    let reqPath: string;
    try {
      reqPath = decodeURIComponent(req.pathname);
    } catch {
      next();
      return;
    }

    // == 路径安全验证

    const targetPath = resolve(join(resolvedRoot, reqPath));

    // 防路径遍历：目标路径必须以 resolvedRoot + 分隔符 开头（或等于 resolvedRoot）
    if (!targetPath.startsWith(resolvedRoot + sep) && targetPath !== resolvedRoot) {
      res.status(403).send('Forbidden');
      return;
    }

    // == dotfile 策略

    const segments = reqPath.split('/').filter(Boolean);
    const hasDotSegment = segments.some((seg) => basename(seg).startsWith('.'));

    if (hasDotSegment) {
      switch (dotFiles) {
        case 'deny':
          res.status(403).send('Forbidden');
          return;
        case 'ignore':
          next();
          return;
        case 'allow':
          break;
      }
    }

    // == 设置缓存头辅助函数

    function setCacheHeaders(): void {
      if (maxAge > 0) {
        res.setHeader('cache-control', `public, max-age=${maxAge}`);
      } else {
        res.setHeader('cache-control', 'no-cache');
      }
    }

    // == 文件系统查找

    stat(targetPath, (err, stats) => {
      if (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
          next();
        } else {
          next(err);
        }
        return;
      }

      if (stats.isDirectory()) {
        if (indexFile === false) {
          next();
          return;
        }

        const indexPath = join(targetPath, indexFile);
        stat(indexPath, (indexErr, indexStats) => {
          if (indexErr || !indexStats.isFile()) {
            next();
            return;
          }
          setCacheHeaders();
          res.sendFile(indexPath).catch(() => { /* sendFile 内部已处理错误 */ });
        });
        return;
      }

      if (!stats.isFile()) {
        next();
        return;
      }

      setCacheHeaders();
      res.sendFile(targetPath).catch(() => { /* sendFile 内部已处理错误 */ });
    });
  };
}
