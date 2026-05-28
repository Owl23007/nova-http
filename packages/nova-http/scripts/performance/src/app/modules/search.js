export function createSearchSubApp(createApp) {
  const search = createApp();

  search.get("/", (req, res) => handleSearch(req, res));

  return search;
}

async function handleSearch(req, res) {
  const query = req.query.get("q") || "";
  const limit = Math.min(Math.max(Number(req.query.get("limit") || 10), 1), 50);
  const cacheKey = `search:${query}:${limit}`;
  // 搜索列表按查询参数缓存，模拟读多写少的典型 API。
  const cached = await req.context.redis.get(cacheKey);

  if (cached) {
    res.setHeader("x-cache", "HIT");
    res.json(JSON.parse(cached));
    return;
  }

  const items = Array.from({ length: limit }, (_, index) => ({
    id: `${query || "item"}-${index + 1}`,
    score: 1 - index / 100,
  }));
  const payload = { query, limit, items };

  await req.context.redis.set(cacheKey, JSON.stringify(payload), { ttlMs: 15_000 });
  res.setHeader("x-cache", "MISS");
  res.json(payload);
}
