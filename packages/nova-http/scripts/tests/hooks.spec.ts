import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Hooks } from "../../src/core";

describe("Hooks", () => {
  it("reports a rejected Promise created in another realm", async () => {
    const hooks = new Hooks();
    const error = new Error("cross-realm rejection");
    let observedError: unknown;

    hooks.addHook("onError", ({ error: hookError }) => {
      observedError = hookError;
    });
    hooks.addHook(
      "onClose",
      () => runInNewContext("Promise.reject(error)", { error }) as Promise<void>,
    );

    hooks.emitHook("onClose", undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(observedError).toBe(error);
  });
});
