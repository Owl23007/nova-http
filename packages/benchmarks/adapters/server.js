/**
 * @file 适配器服务端启动器
 * @description 通过 fork 启动子进程，加载指定适配器和场景，监听空闲端口并返回给父进程
 */

import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import { scenarios } from "../suites/http/scenarios.js";

const require = createRequire(import.meta.url);
const target = JSON.parse(process.argv[2]);
const scenario = scenarios[process.argv[3]];
const name = process.argv[3];
const HOST = "127.0.0.1";
const KEEP_ALIVE_TIMEOUT = 65000;
const route = name === "params-query" ? "/users/:id" : "/";

// 前置判断: 诊断变体仅用于本地开发和 PR 验证，RC 或 Release 中使用固定的基准场景和目标
if (target.diagnostic && !["preencoded", "direct"].includes(target.diagnostic))
  throw new Error("未知诊断变体");
if (target.diagnostic && (target.adapter !== "nova" || name !== "json-small"))
  throw new Error("诊断变体仅支持 Nova json-small");

const encoded = JSON.stringify(scenario.expected);

let app;
let port;

// 5 层中间件，用于测试中间件链路的性能
const layers = Array.from({ length: 5 }, () => (state) => {
  state.layers += 1;
});
const runLayers = () => {
  const state = { layers: 0 };
  for (const layer of layers) layer(state);
  return state;
};

// 监听 Nova 应用，分配空闲端口
const listenNova = async (novaApp) => {
  if (typeof novaApp.address !== "function") {
    // baseline 不暴露底层 server，先探测端口，再通过公开 listen 启动
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, HOST, () => resolve(undefined)));
    const address = probe.address();
    if (!address || typeof address === "string") throw new Error("空闲端口分配失败");
    await new Promise((resolve) => probe.close(resolve));
    await novaApp.listen(address.port, HOST);
    return address.port;
  }

  await novaApp.listen(0, HOST);
  return novaApp.address().port;
};

// 根据适配器类型启动服务
switch (target.adapter) {
  // Nova 支持自定义中间件、诊断分支和兼容不同版本的监听接口
  case "nova": {
    const { createApp, bodyParser } = require(target.entry);
    app = createApp({ keepAliveTimeout: KEEP_ALIVE_TIMEOUT });
    // 中间件和路由配置
    if (name === "json-echo") app.use(bodyParser());
    if (name === "middleware-5") {
      for (const layer of layers)
        app.use((req, _res, next) => {
          req.context.benchmark ??= { layers: 0 };
          layer(req.context.benchmark);
          return next();
        });
    }
    // 路由处理
    app[scenario.method.toLowerCase()](route, (req, res) => {
      let value = scenario.expected;
      if (name === "params-query") value = { id: req.params.id, q: req.query.get("q") };
      if (name === "json-echo") value = req.context.bodyParserData?.body ?? req.bodyParsed;
      if (name === "middleware-5") value = req.context.benchmark;
      res.setHeader("content-type", scenario.type);
      if (target.diagnostic === "preencoded") res.send(encoded);
      else if (typeof value === "string") res.send(value);
      else res.json(value);
    });
    if (target.diagnostic === "direct") {
      // 只绕过应用分发，仍等待真实响应完成，保证测量包含完整传输链路
      app.dispatch = async (_req, res) => {
        res.setHeader("content-type", scenario.type);
        res.json(scenario.expected);
        // oxlint-disable-next-line no-underscore-dangle
        await res._waitForFinish();
      };
    }
    port = await listenNova(app);
    break;
  }
  // Fastify 使用 hook 和原生 schema 完成对应的基准场景配置
  case "fastify": {
    app = require("fastify")({ logger: false, keepAliveTimeout: KEEP_ALIVE_TIMEOUT });
    if (name === "middleware-5") {
      app.decorateRequest("benchmark", null);
      for (const layer of layers)
        app.addHook("preHandler", (req, _res, done) => {
          req.benchmark ??= { layers: 0 };
          layer(req.benchmark);
          done();
        });
    }
    const options =
      // 仅对 json-small 开启响应校验，单独测量 schema 的影响
      target.schema && name === "json-small"
        ? {
            schema: {
              response: {
                200: {
                  type: "object",
                  properties: { hello: { type: "string" } },
                  required: ["hello"],
                  additionalProperties: false,
                },
              },
            },
          }
        : {};
    app.route({
      method: scenario.method,
      url: route,
      ...options,
      handler(req, res) {
        let value = scenario.expected;
        if (name === "params-query") value = { id: req.params.id, q: req.query.q };
        if (name === "json-echo") value = req.body;
        if (name === "middleware-5") value = req.benchmark;
        return res.type(scenario.type).send(value);
      },
    });
    await app.listen({ port: 0, host: HOST });
    port = app.server.address().port;
    break;
  }
  // Node 原生实现作为不含框架分发开销的对照组
  case "node": {
    app = http.createServer(async (req, res) => {
      let value = scenario.expected;
      if (name === "params-query") {
        const url = new URL(req.url, "http://localhost");
        value = {
          id: decodeURIComponent(url.pathname.split("/")[2]),
          q: url.searchParams.get("q"),
        };
      }
      if (name === "json-echo") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        value = JSON.parse(Buffer.concat(chunks).toString());
      }
      if (name === "middleware-5") value = runLayers();
      res.setHeader("content-type", scenario.type);
      res.end(typeof value === "string" ? value : JSON.stringify(value));
    });
    app.keepAliveTimeout = KEEP_ALIVE_TIMEOUT;
    await new Promise((resolve) => app.listen(0, HOST, resolve));
    const address = app.address();
    if (!address || typeof address === "string") throw new Error("服务端口无效");
    port = address.port;
    break;
  }
  default:
    throw new Error("未知适配器");
}

process.send({ port });
process.on("disconnect", () => process.exit(1));
process.on("SIGTERM", () => process.exit(0));
