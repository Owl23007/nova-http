import type { NovaRequest, NovaResponse } from 'nova-http';

//  内存数据存储（示例用，实际项目接数据库）

interface User {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

let users: User[] = [
  { id: 1, name: '张三', email: 'zhangsan@example.com', createdAt: new Date().toISOString() },
  { id: 2, name: '李四', email: 'lisi@example.com', createdAt: new Date().toISOString() },
];

let nextId = 3;

//  路由处理器 

/**
 * GET /api/users
 * 查询用户列表，支持 ?limit=&offset= 分页
 */
export function listUsers(req: NovaRequest, res: NovaResponse): void {
  const limit = Math.min(Number(req.query.get('limit') ?? 20), 100);
  const offset = Number(req.query.get('offset') ?? 0);

  const page = users.slice(offset, offset + limit);
  res.json({
    total: users.length,
    limit,
    offset,
    data: page,
  });
}

/**
 * GET /api/users/:id
 * 查询单个用户
 */
export function getUser(req: NovaRequest, res: NovaResponse): void {
  const id = Number(req.params['id']);
  const user = users.find(u => u.id === id);

  if (!user) {
    res.status(404).json({ error: `用户 ${id} 不存在` });
    return;
  }

  res.json(user);
}

/**
 * POST /api/users
 * 创建新用户
 */
export function createUser(req: NovaRequest, res: NovaResponse): void {
  const body = req.bodyParsed as Record<string, unknown> | null;

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: '请求体必须为 JSON 对象' });
    return;
  }

  const { name, email } = body as { name?: string; email?: string };

  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: 'name 字段不能为空' });
    return;
  }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'email 格式无效' });
    return;
  }

  // 检查 email 唯一性
  if (users.some(u => u.email === email)) {
    res.status(409).json({ error: `email "${email}" 已被使用` });
    return;
  }

  const user: User = {
    id: nextId++,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  res.status(201).json(user);
}

/**
 * PUT /api/users/:id
 * 全量更新用户
 */
export function updateUser(req: NovaRequest, res: NovaResponse): void {
  const id = Number(req.params['id']);
  const idx = users.findIndex(u => u.id === id);

  if (idx === -1) {
    res.status(404).json({ error: `用户 ${id} 不存在` });
    return;
  }

  const body = req.bodyParsed as Record<string, unknown> | null;

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: '请求体必须为 JSON 对象' });
    return;
  }

  const { name, email } = body as { name?: string; email?: string };

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'name 不能为空字符串' });
      return;
    }
    users[idx]!.name = name.trim();
  }

  if (email !== undefined) {
    if (typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'email 格式无效' });
      return;
    }
    const conflict = users.find(u => u.email === email && u.id !== id);
    if (conflict) {
      res.status(409).json({ error: `email "${email}" 已被使用` });
      return;
    }
    users[idx]!.email = email.toLowerCase().trim();
  }

  res.json(users[idx]);
}

/**
 * DELETE /api/users/:id
 * 删除用户
 */
export function deleteUser(req: NovaRequest, res: NovaResponse): void {
  const id = Number(req.params['id']);
  const idx = users.findIndex(u => u.id === id);

  if (idx === -1) {
    res.status(404).json({ error: `用户 ${id} 不存在` });
    return;
  }

  users.splice(idx, 1);
  res.status(204).end();
}

//  路由注册（供 app.ts 挂载）

import { createApp } from 'nova-http';

// 创建一个子路由 app，挂载到 /api/users
const router = createApp();

router.get('/users', listUsers);
router.post('/users', createUser);
router.get('/users/:id', getUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

export const usersRouter = router;
