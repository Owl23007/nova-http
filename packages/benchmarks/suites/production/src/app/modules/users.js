export function createUsersSubApp(createApp) {
  const users = createApp();

  users.get("/:id", (req, res) => handleGetUser(req, res));

  return users;
}

async function handleGetUser(req, res) {
  const cacheKey = `users:${req.params.id}`;
  // 用户详情优先读 Redis，未命中时回源 SQLite，并写入短 TTL 缓存
  const cached = await req.context.redis.get(cacheKey);

  if (cached) {
    res.setHeader("x-cache", "HIT");
    res.json(JSON.parse(cached));
    return;
  }

  const user = req.context.db.getUser(req.params.id);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }

  const payload = {
    id: user.id,
    name: user.name,
    role: user.role,
    active: Boolean(user.active),
    plan: user.plan,
    requestId: req.context.requestId,
  };

  await req.context.redis.set(cacheKey, JSON.stringify(payload), { ttlMs: 30_000 });
  res.setHeader("x-cache", "MISS");
  res.json(payload);
}
