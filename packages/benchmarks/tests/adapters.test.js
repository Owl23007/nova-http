import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { startTarget } from "../runner/process.js";
import { scenarios } from "../suites/http/scenarios.js";
import { validate, validatePipeline } from "../suites/http/validate.js";
import { measure } from "../suites/http/driver.js";
import { metrics } from "../report/results.js";
const require = createRequire(import.meta.url);
for (const target of [
  { id: "nova", adapter: "nova", entry: require.resolve("nova-http") },
  { id: "fastify-schema", adapter: "fastify", schema: true },
  { id: "fastify-no-schema", adapter: "fastify", schema: false },
  { id: "node", adapter: "node" },
]) {
  for (const [name, scenario] of Object.entries(scenarios))
    it(`${target.id} ${name} 响应与流水线`, async () => {
      const server = await startTarget(target, name);
      try {
        await validate(server.port, scenario);
        if (name === "json-echo") {
          const result = await measure(
            server.port,
            scenario,
            { connections: 10, pipelining: 10 },
            1,
            { child: server.child },
          );
          expect(result.checked).toBeGreaterThan(0);
          expect(result.invalid).toBe(0);
          expect(metrics(result.raw).errors).toBe(0);
          expect(metrics(result.raw).mismatches).toBe(0);
        }
        if (name === "params-query")
          await validate(server.port, scenario, "/users/73?q=other", { id: "73", q: "other" });
        await validatePipeline(server.port, scenario);
      } finally {
        await server.stop();
      }
      expect(server.child.exitCode !== null || server.child.signalCode !== null).toBe(true);
    });
}
