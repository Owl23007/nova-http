import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { stats } from "../../report/results.js";
import { validBody } from "../http/scenarios.js";
const require = createRequire(import.meta.url);

export function microCases() {
  // 延迟加载构建产物，确保命令先构建 Nova，再读取当前实现
  const protocol = require("nova-http/protocol/http1");
  const {
    Router,
    Application,
    NovaRequest,
    NovaResponse,
    HeaderBlock,
    IncomingBody,
  } = require("nova-http/core");
  const expected = { hello: "world" };
  const body = JSON.stringify(expected);
  const bytes = Buffer.from("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
  const parsed = protocol.parseHead(bytes, protocol.DEFAULT_PARSER_LIMITS);
  if ("fatal" in parsed) throw new Error(parsed.code);
  const headers = new Map([
    ["content-type", "application/json; charset=utf-8"],
    ["content-length", "17"],
  ]);
  const router = new Router();
  router.add("GET", "/", () => {});
  router.add("GET", "/users/:id", () => {});
  const parse = (chunks) => {
    const input = new protocol.SegmentedInput();
    const scanner = protocol.createHeadScanState();
    let head;
    for (const chunk of chunks) {
      input.append(chunk);
      const scan = protocol.scanHead(input, scanner, protocol.DEFAULT_PARSER_LIMITS);
      if (scan.type === "error") throw new Error(scan.error.code);
      if (scan.type === "complete") {
        const parsedHead = protocol.parseHead(
          protocol.takeScannedBlock(input, scan.length),
          protocol.DEFAULT_PARSER_LIMITS,
        );
        if ("fatal" in parsedHead) throw new Error(parsedHead.code);
        head = protocol.buildRequestHead(parsedHead);
      }
    }
    if (!head || "fatal" in head || head.method !== "GET") throw new Error("Parser result invalid");
    return head;
  };
  const single = [bytes];
  const split = [bytes.subarray(0, 7), bytes.subarray(7, 29), bytes.subarray(29)];
  const response = () => {
    // 内存输出端保留响应状态机，排除真实 TCP 写出和背压成本
    const sink = {
      reusable: true,
      bodyBytesWritten: 0,
      assertHeaderAllowed() {},
      sendFixed(_status, _headers, value) {
        this.bodyBytesWritten += value.length;
      },
      async commit() {},
      async write() {},
      async end() {},
    };
    return new NovaResponse(sink, {
      signal: new AbortController().signal,
      onFailure(error) {
        throw error;
      },
    });
  };
  const request = () => {
    const stream = new IncomingBody(false, 16384, () => {});
    // 模拟协议层已读完空请求体，不把挂起的 Readable 混入分发计时
    // oxlint-disable-next-line no-underscore-dangle
    stream._complete();
    return new NovaRequest(
      {
        method: "GET",
        path: "/",
        rawTarget: "/",
        version: "1.1",
        headers: new HeaderBlock([]),
        trailers: new HeaderBlock([]),
        body: stream,
        connection: { close: false, connect: false },
        peer: {},
        clientIp: "127.0.0.1",
      },
      new AbortController().signal,
    );
  };
  const app = new Application();
  app.get("/", (_req, res) => res.json(expected));
  const middleware = new Application();
  for (let i = 0; i < 5; i++) middleware.use((_req, _res, next) => next());
  middleware.get("/", (_req, res) => res.json(expected));
  return [
    { id: "parser-contiguous", run: () => parse(single), check: (v) => v.method === "GET" },
    { id: "parser-split-3", run: () => parse(split), check: (v) => v.method === "GET" },
    {
      id: "parser-head-only",
      run: () => protocol.parseHead(bytes, protocol.DEFAULT_PARSER_LIMITS),
      check: (v) => !v.fatal,
    },
    {
      id: "parser-framing-only",
      run: () => protocol.buildRequestHead(parsed),
      check: (v) => v.method === "GET",
    },
    { id: "router-static", run: () => router.find("GET", "/"), check: (v) => !!v?.handler },
    {
      id: "router-params",
      run: () => router.find("GET", "/users/42"),
      check: (v) => v?.params.id === "42",
    },
    { id: "json-stringify", run: () => JSON.stringify(expected), check: (v) => v === body },
    {
      id: "client-semantic-validation",
      run: () => validBody(body, expected),
      check: (v) => v === true,
    },
    {
      id: "response-plan-encode",
      run: () =>
        protocol.serializeResponseHead(
          "1.1",
          200,
          protocol.resolveResponsePlan("GET", "1.1", false, 200, headers).headers,
        ),
      check: (v) => v.toString().includes("content-length: 17"),
    },
    {
      id: "response-json-memory-sink",
      run: () => {
        const res = response();
        res.json(expected);
        return res;
      },
      check: (v) => v.bodyBytesWritten === 17 && v.writableEnded,
    },
    {
      id: "dispatch-memory-sink",
      async: true,
      run: async () => {
        const res = response();
        await app.dispatch(request(), res);
        return res;
      },
      check: (v) => v.bodyBytesWritten === 17,
    },
    {
      id: "middleware-5-memory-sink",
      async: true,
      run: async () => {
        const res = response();
        await middleware.dispatch(request(), res);
        return res;
      },
      check: (v) => v.bodyBytesWritten === 17,
    },
  ];
}

export async function runMicro({ iterations, rounds }) {
  // 轮换组件顺序，预热不计入结果，同步组件不额外引入逐次 await
  // 各项包含不同的对象创建和调用成本，不能相加作为端到端耗时占比
  const cases = microCases();
  const results = cases.map((test) => ({ id: test.id, rounds: [], statistics: null }));
  for (let round = 0; round < rounds; round++) {
    for (const test of [
      ...cases.slice(round % cases.length),
      ...cases.slice(0, round % cases.length),
    ]) {
      const execute = async (count) => {
        let value;
        const start = performance.now();
        for (let offset = 0; offset < count; offset += 1000) {
          const end = Math.min(count, offset + 1000);
          if (test.async) for (let i = offset; i < end; i++) value = await test.run();
          else for (let i = offset; i < end; i++) value = test.run();
          // 定期排空 Readable 的 nextTick，防止长微任务链积压请求对象
          // 调度开销保留在总时间内，不通过扣除时间制造更好的成绩
          await setImmediate();
        }
        const elapsedMs = performance.now() - start;
        if (!test.check(value)) throw new Error(`Invalid micro result: ${test.id}`);
        return { iterations: count, elapsedMs, nsPerOp: (elapsedMs * 1e6) / count };
      };
      await execute(Math.min(iterations, 10000));
      const result = results.find((item) => item.id === test.id);
      result.rounds.push(await execute(iterations));
      result.statistics = stats(result.rounds.map((item) => item.nsPerOp));
    }
  }
  return results;
}
