import { resolve } from "node:path";
import { createApp } from "nova-http";
import { sendFile } from "nova-http/static";

export function buildApp(root = "./public") {
  const app = createApp();
  const files = new Map([["manual", resolve(root, "manual.txt")]]);
  const download = async (req, res) => {
    const file = files.get(req.params.id);
    if (!file) {
      res.status(404).send("Not Found");
      return;
    }
    res.setHeader("content-disposition", 'attachment; filename="manual.txt"');
    await sendFile(req, res, file);
  };
  app.get("/downloads/:id", download);
  app.head("/downloads/:id", download);
  return app;
}

if (!process.env.NOVA_DOCS_CHECK) {
  await buildApp().listen(3000, "127.0.0.1");
  console.log("http://127.0.0.1:3000/downloads/manual");
}
