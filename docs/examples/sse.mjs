import { setTimeout } from "node:timers/promises";
import { createApp } from "nova-http";

export function buildApp() {
  const app = createApp();
  app.get("/events", async (req, res) => {
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    await res.flushHeaders();
    try {
      for (let id = 1; id <= 3; id++) {
        await res.write(`id: ${id}\nevent: tick\ndata: ${JSON.stringify({ id })}\n\n`);
        await setTimeout(100, undefined, { signal: req.signal });
      }
      await res.end();
    } catch (error) {
      if (!req.signal.aborted) throw error;
    }
  });
  return app;
}

if (!process.env.NOVA_DOCS_CHECK) {
  await buildApp().listen(3000, "127.0.0.1");
  console.log("http://127.0.0.1:3000/events");
}
