const { createApp } = require('nova-http');

let users = [
  { id: 1, name: '张三', email: 'zhangsan@example.com', createdAt: new Date().toISOString() },
  { id: 2, name: '李四', email: 'lisi@example.com', createdAt: new Date().toISOString() },
];

let nextId = 3;

function listUsers(req, res) {
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

function getUser(req, res) {
  const id = Number(req.params.id);
  const user = users.find((item) => item.id === id);

  if (!user) {
    res.status(404).json({ error: `用户 ${id} 不存在` });
    return;
  }

  res.json(user);
}

function createUser(req, res) {
  const body = req.bodyParsed;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: '请求体必须为 JSON 对象' });
    return;
  }

  const { name, email } = body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: 'name 字段不能为空' });
    return;
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'email 格式无效' });
    return;
  }
  if (users.some((item) => item.email === email)) {
    res.status(409).json({ error: `email "${email}" 已被使用` });
    return;
  }

  const user = {
    id: nextId++,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  res.status(201).json(user);
}

function updateUser(req, res) {
  const id = Number(req.params.id);
  const idx = users.findIndex((item) => item.id === id);

  if (idx === -1) {
    res.status(404).json({ error: `用户 ${id} 不存在` });
    return;
  }

  const body = req.bodyParsed;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: '请求体必须为 JSON 对象' });
    return;
  }

  const { name, email } = body;
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'name 不能为空字符串' });
      return;
    }
    users[idx].name = name.trim();
  }

  if (email !== undefined) {
    if (typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'email 格式无效' });
      return;
    }
    const conflict = users.find((item) => item.email === email && item.id !== id);
    if (conflict) {
      res.status(409).json({ error: `email "${email}" 已被使用` });
      return;
    }
    users[idx].email = email.toLowerCase().trim();
  }

  res.json(users[idx]);
}

function deleteUser(req, res) {
  const id = Number(req.params.id);
  const idx = users.findIndex((item) => item.id === id);

  if (idx === -1) {
    res.status(404).json({ error: `用户 ${id} 不存在` });
    return;
  }

  users.splice(idx, 1);
  res.status(204).end();
}

const router = createApp();
router.get('/users', listUsers);
router.post('/users', createUser);
router.get('/users/:id', getUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

module.exports = {
  usersRouter: router,
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
};
