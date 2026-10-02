import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import { scenarios } from "../suites/http/scenarios.js";

const require = createRequire(import.meta.url);
const target = JSON.parse(process.argv[2]);
const scenario = scenarios[process.argv[3]];
const name = process.argv[3];
let app;
let port;
const layers = Array.from({ length: 5 }, () => (state) => {
  state.layers += 1;
});
const runLayers = () => {
  const state = { layers: 0 };
  for (const layer of layers) layer(state);
  return state;
};

if (target.adapter === "nova") {
  const { createApp, bodyParser } = require(target.entry);
  app = createApp({ keepAliveTimeout: 65000 });
  if (name === "json-echo") app.use(bodyParser());
  if (name === "middleware-5") {
    for (const layer of layers)
      app.use((req, _res, next) => {
        req.context.benchmark ??= { layers: 0 };
        layer(req.context.benchmark);
        return next();
      });
  }
  const route = name === "params-query" ? "/users/:id" : "/";
  app[scenario.method.toLowerCase()](route, (req, res) => {
    let value = scenario.expected;
    if (name === "params-query") value = { id: req.params.id, q: req.query.get("q") };
    if (name === "json-echo")
      value =
        target.bodyAPI === "legacy"
          ? req.bodyParsed
          : (req.context.bodyParserData?.body ?? req.bodyParsed);
    if (name === "middleware-5") value = req.context.benchmark;
    res.setHeader("content-type", scenario.type);
    if (typeof value === "string") res.send(value);
    else res.json(value);
  });
  if (typeof app.address !== "function") {
    // 旧版没有公开 address 方法，先申请空闲端口再通过公开 listen 启动
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", () => resolve(undefined)));
    const address = probe.address();
    if (!address || typeof address === "string") throw new Error("空闲端口分配失败");
    port = address.port;
    await new Promise((resolve) => probe.close(resolve));
    await app.listen(port, "127.0.0.1");
  } else {
    await app.listen(0, "127.0.0.1");
    port = app.address().port;
  }
} else if (target.adapter === "fastify") {
  app = require("fastify")({ logger: false, keepAliveTimeout: 65000 });
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
    url: name === "params-query" ? "/users/:id" : "/",
    ...options,
    handler(req, res) {
      let value = scenario.expected;
      if (name === "params-query") value = { id: req.params.id, q: req.query.q };
      if (name === "json-echo") value = req.body;
      if (name === "middleware-5") value = req.benchmark;
      return res.type(scenario.type).send(value);
    },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = app.server.address().port;
} else if (target.adapter === "node") {
  app = http.createServer(async (req, res) => {
    let value = scenario.expected;
    if (name === "params-query") {
      const url = new URL(req.url, "http://localhost");
      value = { id: decodeURIComponent(url.pathname.split("/")[2]), q: url.searchParams.get("q") };
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
  app.keepAliveTimeout = 65000;
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("服务端口无效");
  port = address.port;
} else throw new Error("未知适配器");

process.send({ port });
process.on("disconnect", () => process.exit(1));
process.on("SIGTERM", () => process.exit(0));
