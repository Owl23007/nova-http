import { createApp } from "nova-http";

export function buildApp() {
  const app = createApp();
  app.get("/hello/:name", (req, res) => {
    res.json({ hello: req.params.name });
  });
  return app;
}

// Run the app if not running in docs check mode
if (!process.env.NOVA_DOCS_CHECK) {
  await buildApp().listen(3000, "127.0.0.1");
  console.log("http://127.0.0.1:3000/hello/Nova");
}
