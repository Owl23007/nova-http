import { bodyParser, createApp } from "nova-http";

export function buildApp() {
  const app = createApp();
  const notes = new Map();
  let nextId = 1;

  app.post("/notes", bodyParser({ types: ["json"] }), (req, res) => {
    const body = req.context.bodyParserData?.body;
    if (!body || typeof body !== "object" || typeof body.text !== "string" || !body.text.trim()) {
      res.status(400).json({ error: "text must be a non-empty string" });
      return;
    }
    const note = { id: String(nextId++), text: body.text.trim() };
    notes.set(note.id, note);
    res.status(201).setHeader("location", `/notes/${note.id}`).json(note);
  });

  app.get("/notes/:id", (req, res) => {
    const note = notes.get(req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(note);
  });
  return app;
}

if (!process.env.NOVA_DOCS_CHECK) {
  await buildApp().listen(3000, "127.0.0.1");
  console.log("http://127.0.0.1:3000/notes");
}
