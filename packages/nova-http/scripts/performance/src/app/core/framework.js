import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const distEntry = fileURLToPath(new URL("../../../../../dist/src/index.js", import.meta.url));

export function loadNovaHttp() {
  try {
    return require(distEntry);
  } catch (error) {
    console.error("[performance-api] Failed to load dist build from dist/src/index.js.");
    console.error('[performance-api] Run "pnpm -F nova-http run build" first.');
    throw error;
  }
}
