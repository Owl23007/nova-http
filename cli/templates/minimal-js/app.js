const { bodyParser, createApp } = require('nova-http');

const app = createApp();

app.use(bodyParser());

app.get('/', (_req, res) => {
  res.json({ message: 'Hello from {{name}}!', timestamp: Date.now() });
});

app.get('/hello/:name', (req, res) => {
  const { name } = req.params;
  res.json({ greeting: `你好，${name}！` });
});

app.post('/echo', (req, res) => {
  res.json({ received: req.bodyParsed });
});

app.use((err, _req, res, _next) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(error.stack);
  res.status(500).json({ error: error.message });
});

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  {{name}} 已启动`);
  console.log(`  本地: http://localhost:${PORT}\n`);
});

