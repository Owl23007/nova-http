import { stat } from "fs/promises";
import { basename, join, normalize, resolve, sep } from "path";
import type { NextFunction, NovaRequest, NovaResponse } from "../core";

/**
 * 静态文件中间件配置项
 */
export interface StaticFilesOptions {
  /**
   * `Cache-Control` 的 `max-age` 秒数
   *
   * 设为 `0` 时发送 `Cache-Control: no-cache`
   *
   * @defaultValue `3600`
   */
  maxAge?: number;

  /**
   * 目录访问时尝试返回的默认文件名
   *
   * 设为 `false` 时禁用目录索引文件回退
   *
   * @defaultValue `"index.html"`
   */
  index?: string | false;

  /**
   * dotfile（以 `.` 开头的文件或目录）处理策略
   *
   * - `"ignore"`：跳过静态文件处理，通常由后续流程返回 404
   * - `"allow"`：允许访问
   * - `"deny"`：直接返回 403
   *
   * @defaultValue `"ignore"`
   */
  dotFiles?: "ignore" | "allow" | "deny";

  /**
   * 是否启用 ETag
   *
   * 当前 ETag 由 `res.sendFile()` 统一生成
   *
   * @defaultValue `true`
   */
  etag?: boolean;

  /**
   * 是否启用 Last-Modified
   *
   * 当前 Last-Modified 由 `res.sendFile()` 统一生成
   *
   * @defaultValue `true`
   */
  lastModified?: boolean;
}

/**
 * 创建静态文件服务中间件
 *
 * 该中间件仅处理 `GET` 和 `HEAD` 请求。它会将请求路径解析到指定根目录下，
 * 并在发送文件前校验目标路径仍位于根目录内，以防止路径遍历访问
 *
 * 支持能力包括：
 *
 * - MIME 类型识别
 * - ETag / Last-Modified 缓存验证
 * - Range 请求
 * - 目录访问时回退到默认索引文件
 * - dotfile 访问策略控制
 *
 * @param root - 静态文件根目录，可以是相对路径或绝对路径
 * @param options - 静态文件服务配置项
 * @returns 可传入 `app.use()` 的异步中间件。返回 Promise 是为了让中间件链等待文件发送完成
 *
 * @example
 * ```ts
 * app.use(staticFiles("./public"));
 * ```
 *
 * @example
 * ```ts
 * app.use("/assets", staticFiles("./dist", { maxAge: 86400 }));
 * ```
 */
export function staticFiles(
  root: string,
  options: StaticFilesOptions = {},
): (req: NovaRequest, res: NovaResponse, next: NextFunction) => Promise<void> {
  const resolvedRoot = resolve(normalize(root));
  const maxAge = options.maxAge ?? 3600;
  const indexFile = options.index === false ? false : (options.index ?? "index.html");
  const dotFiles = options.dotFiles ?? "ignore";

  return async (req: NovaRequest, res: NovaResponse, next: NextFunction): Promise<void> => {
    // 仅处理 GET 和 HEAD 请求
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    let reqPath: string;
    try {
      reqPath = decodeURIComponent(req.pathname);
    } catch {
      next();
      return;
    }

    // 路径安全验证：目标路径必须位于静态文件根目录内
    const targetPath = resolve(join(resolvedRoot, reqPath));
    if (!targetPath.startsWith(resolvedRoot + sep) && targetPath !== resolvedRoot) {
      res.status(403).send("Forbidden");
      return;
    }

    const segments = reqPath.split("/").filter(Boolean);
    const hasDotSegment = segments.some((seg) => basename(seg).startsWith("."));

    if (hasDotSegment) {
      switch (dotFiles) {
        case "deny":
          res.status(403).send("Forbidden");
          return;
        case "ignore":
          next();
          return;
        case "allow":
          break;
      }
    }

    const setCacheHeaders = (): void => {
      if (maxAge > 0) {
        res.setHeader("cache-control", `public, max-age=${maxAge}`);
      } else {
        res.setHeader("cache-control", "no-cache");
      }
    };

    try {
      const stats = await stat(targetPath);

      if (stats.isDirectory()) {
        if (indexFile === false) {
          next();
          return;
        }

        const indexPath = join(targetPath, indexFile);
        try {
          const indexStats = await stat(indexPath);
          if (!indexStats.isFile()) {
            next();
            return;
          }
          setCacheHeaders();
          await res.sendFile(indexPath);
        } catch {
          next();
        }
        return;
      }

      if (!stats.isFile()) {
        next();
        return;
      }

      setCacheHeaders();
      await res.sendFile(targetPath);
    } catch (err: unknown) {
      if (isNodeError(err)) {
        if (err.code === "ENOENT" || err.code === "ENOTDIR") {
          next();
        } else {
          next(err);
        }
        return;
      }

      next(err);
    }
  };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
