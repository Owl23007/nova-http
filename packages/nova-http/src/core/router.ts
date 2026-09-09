import type { HttpMethod } from "../message/request";
import type { NovaRequest } from "./request";
import type { NovaResponse } from "./response";

// 类型定义

/** 路由处理函数 */
export type Handler = (req: NovaRequest, res: NovaResponse) => void | Promise<void>;

/** 路由匹配结果 */
export interface RouteMatch {
  handler: Handler;
  params: Record<string, string>;
}

// Radix Tree 节点

interface RadixNode {
  /** 节点代表的路径段 [string,':param','*'] */
  segment: string;
  /** 是否是参数节点 */
  isParam: boolean;
  /** 参数名，仅 isParam=true 时有效 */
  paramName?: string;
  /** 是否是通配符节点 */
  isWildcard: boolean;
  /** 子节点列表 */
  children: RadixNode[];
  /** 注册的 HTTP 方法 → 处理函数 */
  handlers: Map<string, Handler>;
}

function createNode(segment: string): RadixNode {
  const isParam = segment.startsWith(":");
  const isWildcard = segment === "*";
  return {
    segment,
    isParam,
    paramName: isParam ? segment.slice(1) : undefined,
    isWildcard,
    children: [],
    handlers: new Map(),
  };
}

// Router
/**
 * Router Radix Tree 路由器
 *
 * 基于前缀压缩的 Radix Tree 实现，支持：
 *   - 精确匹配：`/users/list`
 *   - 参数匹配：`/users/:id` ，单段，注入 params.id
 *   - 通配符匹配：`/static/*`，剩余全部路径，注入 params['*']
 *   - 全部 HTTP 方法：GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS
 *
 * 匹配优先级 - 由高到低：
 *   1. 精确静态段
 *   2. 参数段（:param）
 *   3. 通配符（*）
 *
 * 复杂度：
 *   - 插入：O(k)，k = 路径分段数
 *   - 查找：O(k)，k = 路径分段数
 *   - 空间：O(n·k)，n = 路由总数
 */
export class Router {
  private readonly _root: RadixNode = createNode("/");
  /** 记录已注册路由 */
  private readonly _routes: Array<{ method: HttpMethod; path: string }> = [];

  /**
   * 注册路由
   * @param method HTTP 方法，大小写敏感
   * @param path 路由路径，如 '/users/:id/posts'
   * @param handler 处理函数
   */
  add(method: HttpMethod, path: string, handler: Handler): void {
    const normalizedMethod = validateHttpMethod(method);
    const normalizedPath = normalizePath(path);
    this._routes.push({ method: normalizedMethod, path: normalizedPath });

    const segments = splitPath(normalizedPath);

    if (segments.length === 0) {
      // 根路径
      this._root.handlers.set(normalizedMethod, handler);
      return;
    }

    let node = this._root;

    for (const segment of segments) {
      const child = findChild(node, segment);
      if (child) {
        node = child;
      } else {
        const newNode = createNode(segment);
        insertChild(node, newNode);
        node = newNode;
      }
    }

    node.handlers.set(normalizedMethod, handler);
  }

  /**
   * 查找路由
   * @param method HTTP 方法，查找时会统一转换为大写 token
   * @param pathname 不含 query string 的路径
   * @returns 匹配结果（handler + params），未匹配返回 null
   */
  find(method: HttpMethod, pathname: string): RouteMatch | null {
    const normalizedMethod = validateHttpMethod(method);
    const normalizedPath = normalizePath(pathname);
    const segments = splitPath(normalizedPath);

    if (segments.length === 0) {
      const handler = this._root.handlers.get(normalizedMethod);
      if (handler) return { handler, params: {} };
      return null;
    }

    const params: Record<string, string> = {};
    const node = this._findNode(this._root, segments, 0, params);

    if (!node) return null;

    const handler = node.handlers.get(normalizedMethod);
    if (!handler) return null;

    return { handler, params };
  }

  /**
   * 检查路径是否存在（不限方法），用于生成 405 响应
   */
  findAllowedMethods(pathname: string): string[] {
    const normalizedPath = normalizePath(pathname);
    const segments = splitPath(normalizedPath);
    const params: Record<string, string> = {};

    let node: RadixNode | null;
    if (segments.length === 0) {
      node = this._root;
    } else {
      node = this._findNode(this._root, segments, 0, params);
    }

    if (!node) return [];
    return [...node.handlers.keys()];
  }

  /** 获取已注册路由列表 */
  get routes(): ReadonlyArray<{ method: HttpMethod; path: string }> {
    return this._routes;
  }

  // 私有递归查找

  private _findNode(
    node: RadixNode,
    segments: string[],
    depth: number,
    params: Record<string, string>,
  ): RadixNode | null {
    if (depth === segments.length) {
      // 到达末尾节点
      if (node.isWildcard) return node;
      return node.handlers.size > 0 ? node : null;
    }

    const segment = segments[depth];

    // 1. 优先精确匹配静态子节点
    for (const child of node.children) {
      if (!child.isParam && !child.isWildcard && child.segment === segment) {
        const result = this._findNode(child, segments, depth + 1, params);
        if (result) return result;
      }
    }

    // 2. 参数节点匹配（:param）
    for (const child of node.children) {
      if (child.isParam) {
        const snapshot = params[child.paramName!];
        params[child.paramName!] = safeDecodeURIComponent(segment);
        const result = this._findNode(child, segments, depth + 1, params);
        if (result) return result;
        // 回溯
        if (snapshot === undefined) {
          delete params[child.paramName!];
        } else {
          params[child.paramName!] = snapshot;
        }
      }
    }

    // 3. 通配符节点（* 消耗剩余全部路径段）
    for (const child of node.children) {
      if (child.isWildcard) {
        params["*"] = segments.slice(depth).map(safeDecodeURIComponent).join("/");
        if (child.handlers.size > 0) return child;
      }
    }

    return null;
  }
}

// 工具函数

/** 规范化路径：去掉末尾斜杠，确保以 / 开头 */
function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  let p = path;
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** 将路径拆分为段（过滤空字符串） */
function splitPath(path: string): string[] {
  if (path === "/") return [];
  return path.split("/").filter(Boolean);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function validateHttpMethod(method: HttpMethod): HttpMethod {
  if (!isHttpToken(method)) {
    throw new TypeError(`Invalid HTTP method: ${method.substring(0, 20)}`);
  }
  return method;
}

function isHttpToken(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    const isAlphaNum =
      (ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a);
    if (isAlphaNum) continue;
    switch (ch) {
      case 0x21: // !
      case 0x23: // #
      case 0x24: // $
      case 0x25: // %
      case 0x26: // &
      case 0x27: // '
      case 0x2a: // *
      case 0x2b: // +
      case 0x2d: // -
      case 0x2e: // .
      case 0x5e: // ^
      case 0x5f: // _
      case 0x60: // `
      case 0x7c: // |
      case 0x7e: // ~
        break;
      default:
        return false;
    }
  }
  return true;
}

/** 从节点的 children 中查找匹配的子节点（精确匹配） */
function findChild(node: RadixNode, segment: string): RadixNode | undefined {
  for (const child of node.children) {
    if (child.segment === segment) return child;
  }
  return undefined;
}

/**
 * 插入子节点，保持排序：静态节点 > 参数节点 > 通配符节点
 * 这确保 find 时优先尝试精确匹配
 */
function insertChild(parent: RadixNode, child: RadixNode): void {
  if (child.isWildcard) {
    parent.children.push(child);
    return;
  }
  if (child.isParam) {
    // 插在通配符之前
    const wildcardIdx = parent.children.findIndex((c) => c.isWildcard);
    if (wildcardIdx === -1) {
      parent.children.push(child);
    } else {
      parent.children.splice(wildcardIdx, 0, child);
    }
    return;
  }
  // 静态节点：插在所有参数/通配符节点之前
  const paramIdx = parent.children.findIndex((c) => c.isParam || c.isWildcard);
  if (paramIdx === -1) {
    parent.children.push(child);
  } else {
    parent.children.splice(paramIdx, 0, child);
  }
}
