/**
 * JWT-style 身份验证中间件（示例实现）
 *
 * 真实项目中请替换为正规 JWT 验证。
 */
function authMiddleware() {
  return function auth(req, res, next) {
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

    const parts = token.split('.');
    if (parts.length !== 3) {
      res.status(401).json({ error: 'Token 格式无效' });
      return;
    }

    let payload;
    try {
      const decoded = Buffer.from(parts[1], 'base64').toString('utf8');
      payload = JSON.parse(decoded);
    } catch {
      res.status(401).json({ error: 'Token 解析失败' });
      return;
    }

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      res.status(401).json({ error: 'Token 已过期' });
      return;
    }

    if (typeof payload.id !== 'number' || typeof payload.username !== 'string') {
      res.status(401).json({ error: 'Token payload 缺少必要字段' });
      return;
    }

    req.context.user = payload;
    next();
  };
}

module.exports = { authMiddleware };

