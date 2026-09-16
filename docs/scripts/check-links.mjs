import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { navigation, sidebar } from "../.vitepress/navigation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.vitepress/dist");
const origin = "https://nova-docs.invalid";
const base = `/${(process.env.DOCS_BASE ?? "/").replace(/^\/+|\/+$/g, "")}`.replace(/^\/$/, "");
const errors = [];
const pages = new Map();
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...(await walk(join(directory, entry.name))));
    else if (entry.name.endsWith(".html")) files.push(join(directory, entry.name));
  }
  return files;
}
for (const file of await walk(root)) {
  const html = await readFile(file, "utf8");
  const path = "/" + relative(root, file).replaceAll("\\", "/");
  pages.set(path, {
    html,
    ids: new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => decode(m[1]))),
  });
  if (path !== "/404.html" && (html.match(/<h1(?:\s|>)/g) ?? []).length !== 1) {
    errors.push(`${path}: expected exactly one h1`);
  }
}
function decode(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}
async function check(href, source) {
  if (!href || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(href)) return;
  const url = new URL(
    decode(href),
    origin + base + source.replace(/index\.html$/, "").replace(/\.html$/, ""),
  );
  if (url.origin !== origin) return;
  const deployedPath = decodeURIComponent(url.pathname);
  const path =
    base && deployedPath.startsWith(`${base}/`) ? deployedPath.slice(base.length) : deployedPath;
  const candidates = path.endsWith("/")
    ? [path + "index.html"]
    : [path, path + ".html", path + "/index.html"];
  const target = candidates.find((candidate) => pages.has(candidate));
  if (!target) {
    try {
      if ((await stat(join(root, path))).isFile()) return;
    } catch {
      /* Report missing files below. */
    }
    errors.push(`${source}: missing ${href}`);
  } else if (url.hash && !pages.get(target).ids.has(decodeURIComponent(url.hash.slice(1)))) {
    errors.push(`${source}: missing anchor ${href}`);
  }
}
for (const [path, { html }] of pages) {
  for (const match of html.matchAll(/<(?:a|img|script|link)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
    await check(match[1], path);
  }
}
async function checkNavigation(items) {
  for (const item of items) {
    if (item.link) await check(item.link, "/index.html");
    if (item.items) await checkNavigation(item.items);
  }
}
await checkNavigation(navigation);
for (const items of Object.values(sidebar)) await checkNavigation(items);
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${pages.size} rendered pages: links, assets, anchors, navigation and headings.`,
  );
}
