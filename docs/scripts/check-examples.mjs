import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NOVA_DOCS_CHECK = "1";
const hello = await import("../examples/hello.mjs");
const notes = await import("../examples/rest-api.mjs");
const sse = await import("../examples/sse.mjs");
const download = await import("../examples/file-download.mjs");

async function withApp(app, run) {
  await app.listen(0, "127.0.0.1");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await run((path, options = {}) =>
      fetch(base + path, {
        ...options,
        headers: { connection: "close", ...options.headers },
        signal: AbortSignal.timeout(5000),
      }),
    );
  } finally {
    await app.close();
  }
}
await withApp(hello.buildApp(), async (request) => {
  const response = await request("/hello/Nova");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hello: "Nova" });
  const head = await request("/hello/Nova", { method: "HEAD" });
  assert.equal(head.status, 405);
  await head.text();
});
await withApp(notes.buildApp(), async (request) => {
  const created = await request("/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Read docs" }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("location"), "/notes/1");
  assert.deepEqual(await created.json(), { id: "1", text: "Read docs" });
  const found = await request("/notes/1");
  assert.equal((await found.json()).text, "Read docs");
  const invalid = await request("/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"text":""}',
  });
  assert.equal(invalid.status, 400);
  await invalid.text();
  const missing = await request("/notes/missing");
  assert.equal(missing.status, 404);
  await missing.text();
});
await withApp(sse.buildApp(), async (request) => {
  const response = await request("/events");
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  const start = new TextDecoder().decode(first.value);
  assert.match(start, /id: 1\nevent: tick/);
  assert.doesNotMatch(start, /id: 3/);
  let text = start;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    text += new TextDecoder().decode(next.value);
  }
  assert.equal((text.match(/event: tick/g) ?? []).length, 3);
  const cancelled = await request("/events");
  const partial = cancelled.body.getReader();
  await partial.read();
  await partial.cancel();
});
const directory = await mkdtemp(join(tmpdir(), "nova-docs-download-"));
try {
  await writeFile(join(directory, "manual.txt"), "Nova manual");
  await withApp(download.buildApp(directory), async (request) => {
    const file = await request("/downloads/manual");
    assert.equal(await file.text(), "Nova manual");
    const partial = await request("/downloads/manual", { headers: { range: "bytes=0-3" } });
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), "Nova");
    const head = await request("/downloads/manual", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("content-length"), "11");
    const missing = await request("/downloads/unknown");
    assert.equal(missing.status, 404);
    await missing.text();
  });
} finally {
  // mkdtemp returns a unique absolute directory owned by this check.
  await rm(directory, { recursive: true, force: true });
}
console.log(
  "Verified four documentation examples: HTTP, JSON validation, incremental SSE/cancellation, HEAD and Range.",
);
