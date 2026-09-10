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

describe("钩子边界", () => {
  it("仅暴露受控接口并支持移除监听器", () => {
    const hooks = new Hooks();
    let calls = 0;
    const listener = () => {
      calls++;
    };
    hooks.addHook("onClose", listener);
    hooks.emitHook("onClose", undefined);
    hooks.removeHook("onClose", listener);
    hooks.emitHook("onClose", undefined);
    expect(calls).toBe(1);
    expect("emit" in hooks).toBe(false);
    expect("on" in hooks).toBe(false);
  });

  it("同步及异步监听器错误不会中断其他监听器", async () => {
    const hooks = new Hooks();
    const errors: unknown[] = [];
    let calls = 0;
    hooks.addHook("onError", ({ error }) => {
      errors.push(error);
    });
    hooks.addHook("onClose", () => {
      throw new Error("同步异常");
    });
    hooks.addHook("onClose", async () => {
      throw new Error("异步异常");
    });
    hooks.addHook("onClose", () => {
      calls++;
    });
    hooks.emitHook("onClose", undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    expect(errors).toHaveLength(2);
  });
});
