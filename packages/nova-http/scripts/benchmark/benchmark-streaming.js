"use strict";

const http = require("http");
const path = require("path");

const { createApp } = require(path.resolve(__dirname, "../../dist/src/index.js"));

const totalBytes = Number(process.env.STREAM_TOTAL_MB || 256) * 1024 * 1024;
const chunkBytes = Number(process.env.STREAM_CHUNK_KB || 64) * 1024;
const slowDelayMs = Number(process.env.STREAM_SLOW_DELAY_MS || 0);

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

async function main() {
  const app = createApp({ requestTimeout: 0 });
  const chunk = Buffer.alloc(chunkBytes, 0x61);

  app.get("/stream", async (_req, res) => {
    res.setHeader("content-type", "application/octet-stream");

    async function* source() {
      let remaining = totalBytes;
      while (remaining > 0) {
        const size = Math.min(remaining, chunk.length);
        yield size === chunk.length ? chunk : chunk.subarray(0, size);
        remaining -= size;
      }
    }

    await res.stream(source());
  });

  await app.listen(0, "127.0.0.1");
  const address = app._server.address();
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 10);

  const startedAt = process.hrtime.bigint();
  let firstByteMs = null;
  let receivedBytes = 0;

  try {
    await new Promise((resolve, reject) => {
      const request = http.get(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/stream",
          headers: { connection: "close" },
        },
        (response) => {
          response.on("data", (data) => {
            if (firstByteMs === null) {
              firstByteMs = elapsedMs(startedAt);
            }
            receivedBytes += data.length;

            if (slowDelayMs > 0) {
              response.pause();
              setTimeout(() => response.resume(), slowDelayMs);
            }
          });
          response.once("end", resolve);
          response.once("error", reject);
        },
      );
      request.once("error", reject);
    });
  } finally {
    clearInterval(sampler);
    await app.close();
  }

  const durationMs = elapsedMs(startedAt);
  if (receivedBytes !== totalBytes) {
    throw new Error(`stream length mismatch: expected ${totalBytes}, received ${receivedBytes}`);
  }

  console.log(
    JSON.stringify(
      {
        totalMiB: totalBytes / 1024 / 1024,
        chunkKiB: chunkBytes / 1024,
        slowDelayMs,
        receivedBytes,
        firstByteMs: Number(firstByteMs?.toFixed(3)),
        durationMs: Number(durationMs.toFixed(3)),
        throughputMiBPerSecond: Number((totalBytes / 1024 / 1024 / (durationMs / 1000)).toFixed(3)),
        baselineRssMiB: Number((baselineRss / 1024 / 1024).toFixed(3)),
        peakRssMiB: Number((peakRss / 1024 / 1024).toFixed(3)),
        rssDeltaMiB: Number(((peakRss - baselineRss) / 1024 / 1024).toFixed(3)),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
