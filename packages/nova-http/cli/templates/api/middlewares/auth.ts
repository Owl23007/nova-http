import type { NovaRequest, NovaResponse, NextFunction, Middleware } from 'nova-http';

/**
 * JWT-style 身份验证中间件（示例实现）
 *
 * 真实项目中请替换为正规 JWT 验证（如 jsonwebtoken 库）。
 * 此示例仅演示中间件模式：从 Authorization 头提取 Bearer token，
 * 解码 base64 payload，注入 req.context.user。
 *
 * 允许通过的 token 格式（仅用于测试）：
 *   eyJ0eXAiOiJKV1QifQ.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiJ9.xxxxx
 *   （即 base64(header).base64({"id":1,"username":"admin"}).signature）
 */

interface JwtPayload {
  id: number;
  username: string;
  exp?: number;
}

export function authMiddleware(): Middleware {
  return function auth(req: NovaRequest, res: NovaResponse, next: NextFunction): void {
    const authHeader = req.headers.get('authorization') ?? '';

    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: '需要身份验证，请在 Authorization 头中提供 Bearer token' });
      return;
    }

    const token = authHeader.slice(7).trim();

    if (token === '') {
      res.status(401).json({ error: 'Token 不能为空' });
      return;
    }

    // 解析 JWT payload（第二段）
    const parts = token.split('.');
    if (parts.length !== 3) {
      res.status(401).json({ error: 'Token 格式无效' });
      return;
    }

    let payload: JwtPayload;
    try {
      // 仅解码，不验证签名（示例！生产环境必须验证签名）
      const decoded = Buffer.from(parts[1]!, 'base64').toString('utf8');
      payload = JSON.parse(decoded) as JwtPayload;
    } catch {
      res.status(401).json({ error: 'Token 解析失败' });
      return;
    }

    // 检查过期（如果有 exp 字段）
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      res.status(401).json({ error: 'Token 已过期' });
      return;
    }

    if (typeof payload.id !== 'number' || typeof payload.username !== 'string') {
      res.status(401).json({ error: 'Token payload 缺少必要字段' });
      return;
    }

    // 将用户信息注入请求上下文
    req.context['user'] = payload;

    next();
  };
}
