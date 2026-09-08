export function createOrdersSubApp(createApp) {
  const orders = createApp();

  orders.post("/", (req, res) => {
    // 写接口保留基本业务校验，压测时能同时覆盖 bodyParser、校验和 SQLite 写入
    const body = req.bodyParsed;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "body must be a JSON object" });
      return;
    }

    const customerId = typeof body.customerId === "string" ? body.customerId : "";
    const items = Array.isArray(body.items) ? body.items : [];

    if (!customerId || items.length === 0) {
      res.status(422).json({ error: "customerId and items are required" });
      return;
    }

    const order = req.context.db.createOrder({
      customerId,
      itemCount: items.length,
    });

    res.status(201).json(order);
  });

  orders.get("/stats", (req, res) => {
    // 统计接口用于测试验证订单确实落库，同时暴露 Redis 计数中间件是否生效
    res.json({
      total: req.context.db.countOrders(),
      redisRequestCount: req.context.redisRequestCount,
    });
  });

  return orders;
}
