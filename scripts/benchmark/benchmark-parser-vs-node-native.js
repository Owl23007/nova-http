'use strict';

const fs = require('fs');
const path = require('path');
const { AsyncResource } = require('async_hooks');
const { HTTPParser, ConnectionsList } = process.binding('http_parser');

const { HttpParser } = require(path.resolve(__dirname, '../../dist/src/core/HttpParser.js'));
const { BufferReader } = require(path.resolve(__dirname, '../../dist/src/core/BufferReader.js'));

const warmupIterations = Number(process.env.BENCH_PARSER_WARMUP || 50_000);
const measureIterations = Number(process.env.BENCH_PARSER_ITERATIONS || 300_000);
const rounds = Number(process.env.BENCH_PARSER_ROUNDS || 3);

const payloadObj = {
  id: 123,
  name: 'nova',
  enabled: true,
  tags: ['bench', 'parser', 'native'],
  data: 'x'.repeat(512),
};
const payloadJson = JSON.stringify(payloadObj);

const scenarios = [
  {
    name: 'GET simple',
    raw: [
      'GET /health HTTP/1.1',
      'Host: 127.0.0.1',
      'Connection: keep-alive',
      '',
      '',
    ].join('\r\n'),
  },
  {
    name: 'GET many-headers',
    raw: [
      'GET /api/v1/items?offset=10&limit=20 HTTP/1.1',
      'Host: 127.0.0.1',
      'User-Agent: benchmark-client/1.0',
      'Accept: application/json',
      'Accept-Encoding: gzip, deflate, br',
      'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control: no-cache',
      'Pragma: no-cache',
      'X-Request-Id: abcdef1234567890',
      'X-Trace-Id: trace1234567890',
      'Connection: keep-alive',
      '',
      '',
    ].join('\r\n'),
  },
  {
    name: 'POST json(512B)',
    raw: [
      'POST /echo HTTP/1.1',
      'Host: 127.0.0.1',
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(payloadJson)}`,
      'Connection: keep-alive',
      '',
      payloadJson,
    ].join('\r\n'),
  },
];

const feedModes = [
  { name: 'contiguous', splitCount: 1 },
  { name: 'split-3', splitCount: 3 },
];

function nsToSec(ns) {
  return ns / 1e9;
}

function formatInt(n) {
  if (!Number.isFinite(n)) return 'n/a';
  return Math.round(n).toLocaleString('en-US');
}

function formatNum(n, digits = 2) {
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(digits);
}

function splitBuffer(buf, count) {
  if (count <= 1 || buf.length <= 1) return [buf];
  const chunks = [];
  const base = Math.floor(buf.length / count);
  let start = 0;
  for (let i = 0; i < count - 1; i += 1) {
    const end = start + base;
    chunks.push(buf.subarray(start, end));
    start = end;
  }
  chunks.push(buf.subarray(start));
  return chunks.filter((chunk) => chunk.length > 0);
}

function makeInputs() {
  const out = [];
  for (const scenario of scenarios) {
    const full = Buffer.from(scenario.raw, 'latin1');
    for (const mode of feedModes) {
      out.push({
        scenario: scenario.name,
        mode: mode.name,
        fullLength: full.length,
        chunks: splitBuffer(full, mode.splitCount),
      });
    }
  }
  return out;
}

function runNova(chunks, iterations) {
  const parser = new HttpParser();
  const reader = new BufferReader();

  let parsed = 0;
  const started = process.hrtime.bigint();

  for (let i = 0; i < iterations; i += 1) {
    let result = { done: false };
    for (let c = 0; c < chunks.length; c += 1) {
      reader.feed(chunks[c]);
      result = parser.parse(reader);
      if (result.done) break;
    }

    if (!result.done) {
      throw new Error('[nova] parse did not complete');
    }
    if (result.error) {
      throw new Error(`[nova] parse error: ${result.error.code} ${result.error.message}`);
    }
    parsed += 1;
  }

  const elapsedNs = Number(process.hrtime.bigint() - started);
  return {
    parsed,
    elapsedNs,
    reqPerSec: parsed / nsToSec(elapsedNs),
  };
}

function createNodeNativeParser() {
  const parser = new HTTPParser();
  const connectionsList = new ConnectionsList();
  const resource = new AsyncResource('BENCH_HTTP_PARSER');
  parser[HTTPParser.kOnHeadersComplete] = () => 0;
  parser[HTTPParser.kOnBody] = () => {};
  parser[HTTPParser.kOnMessageComplete] = () => {};
  // Keep references alive; initialize() does not strongly retain them.
  parser._benchResource = resource;
  parser._benchConnectionsList = connectionsList;

  parser.initialize(
    HTTPParser.REQUEST,
    resource,
    0,
    HTTPParser.kLenientNone,
    connectionsList,
  );

  return parser;
}

function runNodeNative(chunks, iterations) {
  const parser = createNodeNativeParser();
  let parsed = 0;
  const started = process.hrtime.bigint();

  try {
    for (let i = 0; i < iterations; i += 1) {
      for (let c = 0; c < chunks.length; c += 1) {
        const ret = parser.execute(chunks[c]);
        if (ret instanceof Error) {
          throw new Error(`[node-native] parse error: ${ret.code || ''} ${ret.reason || ret.message}`);
        }
      }
      parsed += 1;
    }
  } finally {
    parser._benchResource = null;
    parser._benchConnectionsList = null;
    parser.close();
  }

  const elapsedNs = Number(process.hrtime.bigint() - started);
  return {
    parsed,
    elapsedNs,
    reqPerSec: parsed / nsToSec(elapsedNs),
  };
}

function benchOne(input, iterations) {
  const nova = runNova(input.chunks, iterations);
  const nodeNative = runNodeNative(input.chunks, iterations);
  return {
    ...input,
    iterations,
    nova,
    nodeNative,
    nodeNativeVsNova: nodeNative.reqPerSec / nova.reqPerSec,
  };
}

function averageResults(roundResults) {
  const first = roundResults[0];
  const out = {
    scenario: first.scenario,
    mode: first.mode,
    fullLength: first.fullLength,
    chunkCount: first.chunks.length,
    iterations: first.iterations,
    novaReqPerSec: 0,
    nodeNativeReqPerSec: 0,
    nodeNativeVsNova: 0,
  };

  for (const item of roundResults) {
    out.novaReqPerSec += item.nova.reqPerSec;
    out.nodeNativeReqPerSec += item.nodeNative.reqPerSec;
    out.nodeNativeVsNova += item.nodeNativeVsNova;
  }

  out.novaReqPerSec /= roundResults.length;
  out.nodeNativeReqPerSec /= roundResults.length;
  out.nodeNativeVsNova /= roundResults.length;
  return out;
}

function printSummary(summary) {
  process.stdout.write('\nParser benchmark config (Node native llhttp)\n');
  process.stdout.write(`- warmup iterations: ${warmupIterations}\n`);
  process.stdout.write(`- measure iterations: ${measureIterations}\n`);
  process.stdout.write(`- rounds: ${rounds}\n\n`);

  const header = [
    'Scenario'.padEnd(18, ' '),
    'Mode'.padEnd(12, ' '),
    'Bytes'.padEnd(8, ' '),
    'Chunks'.padEnd(8, ' '),
    'Nova req/s'.padEnd(14, ' '),
    'Node req/s'.padEnd(14, ' '),
    'Node/Nova',
  ].join(' ');
  process.stdout.write(`${header}\n`);
  process.stdout.write(`${'-'.repeat(header.length)}\n`);

  for (const item of summary) {
    const row = [
      item.scenario.padEnd(18, ' '),
      item.mode.padEnd(12, ' '),
      formatInt(item.fullLength).padEnd(8, ' '),
      formatInt(item.chunkCount).padEnd(8, ' '),
      formatInt(item.novaReqPerSec).padEnd(14, ' '),
      formatInt(item.nodeNativeReqPerSec).padEnd(14, ' '),
      `${formatNum(item.nodeNativeVsNova, 2)}x`,
    ].join(' ');
    process.stdout.write(`${row}\n`);
  }
}

function writeRawFile(raw) {
  const outputDir = path.resolve(__dirname, '../../.tmp');
  fs.mkdirSync(outputDir, { recursive: true });
  const outFile = path.join(outputDir, `benchmark-parser-vs-node-native-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(raw, null, 2));
  process.stdout.write(`\n[benchmark] raw results saved: ${outFile}\n`);
}

function main() {
  const inputs = makeInputs();

  process.stdout.write('[benchmark] warmup start\n');
  for (const input of inputs) {
    benchOne(input, warmupIterations);
  }
  process.stdout.write('[benchmark] warmup done\n');

  const grouped = new Map();
  const rawRounds = [];

  for (let r = 0; r < rounds; r += 1) {
    process.stdout.write(`[benchmark] round ${r + 1}/${rounds}\n`);
    for (const input of inputs) {
      const result = benchOne(input, measureIterations);
      rawRounds.push(result);
      const key = `${input.scenario}__${input.mode}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(result);
    }
  }

  const summary = Array.from(grouped.values()).map((items) => averageResults(items));
  printSummary(summary);
  writeRawFile({
    generatedAt: new Date().toISOString(),
    node: process.version,
    config: {
      warmupIterations,
      measureIterations,
      rounds,
      scenarios: scenarios.map((s) => s.name),
      feedModes: feedModes.map((m) => m.name),
    },
    summary,
    rounds: rawRounds.map((r) => ({
      scenario: r.scenario,
      mode: r.mode,
      fullLength: r.fullLength,
      chunkCount: r.chunks.length,
      iterations: r.iterations,
      novaReqPerSec: r.nova.reqPerSec,
      nodeNativeReqPerSec: r.nodeNative.reqPerSec,
      nodeNativeVsNova: r.nodeNativeVsNova,
    })),
  });
}

main();
