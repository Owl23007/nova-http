const { bodyParser, createApp } = require("nova-http");

const app = createApp();

// 内置中间件
app.use(bodyParser());

// 路由
app.get("/", (_req, res) => {
  res.json({ message: "Hello from {{name}}!", timestamp: Date.now() });
});

app.get("/hello/:name", (req, res) => {
  const { name } = req.params;
  res.json({ greeting: `你好，${name}！` });
});

app.post("/echo", (req, res) => {
  res.json({ received: req.context.bodyParserData?.body });
});

// 全局错误处理
const errorHandler = (err, _req, res, _next) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(error.stack);
  res.status(500).json({ error: error.message });
};

app.use(errorHandler);

// 启动服务
const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  {{name}} 已启动`);
  console.log(`  本地: http://localhost:${PORT}\n`);
});
