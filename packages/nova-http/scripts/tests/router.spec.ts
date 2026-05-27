import { describe, expect, it } from "vitest";
import { Router } from "../../src/core";

describe("Router", () => {
  it("UT-ROUTE-01 匹配静态路由", () => {
    const router = new Router();
    const staticHandler = () => {};

    router.add("GET", "/users/profile", staticHandler);

    expect(router.find("GET", "/users/profile")?.handler).toBe(staticHandler);
  });

  it("UT-ROUTE-02 匹配参数路由", () => {
    const router = new Router();
    const paramHandler = () => {};

    router.add("GET", "/users/:id", paramHandler);

    const match = router.find("GET", "/users/1001");

    expect(match?.handler).toBe(paramHandler);
    expect(match?.params).toEqual({ id: "1001" });
  });

  it("UT-ROUTE-03 匹配通配符路由", () => {
    const router = new Router();
    const wildcardHandler = () => {};

    router.add("GET", "/static/*", wildcardHandler);

    const match = router.find("GET", "/static/a/b.js");

    expect(match?.handler).toBe(wildcardHandler);
    expect(match?.params).toEqual({ "*": "a/b.js" });
  });

  it("UT-ROUTE-04 静态路由优先于参数路由和通配符路由", () => {
    const router = new Router();
    const staticHandler = () => {};
    const paramHandler = () => {};
    const wildcardHandler = () => {};

    router.add("GET", "/users/profile", staticHandler);
    router.add("GET", "/users/:id", paramHandler);
    router.add("GET", "/users/*", wildcardHandler);

    const match = router.find("GET", "/users/profile");

    expect(match?.handler).toBe(staticHandler);
    expect(match?.params).toEqual({});
  });

  it("UT-ROUTE-05 方法不匹配时返回允许的方法列表", () => {
    const router = new Router();
    router.add("GET", "/users", () => {});

    expect(router.find("POST", "/users")).toBeNull();
    expect(router.findAllowedMethods("/users")).toEqual(["GET"]);
  });

  it("UT-ROUTE-06 匹配根路由", () => {
    const router = new Router();
    const handler = () => {};

    router.add("GET", "/", handler);

    expect(router.find("GET", "/")?.handler).toBe(handler);
    expect(router.find("GET", "/")?.params).toEqual({});
  });

  it("UT-ROUTE-07 注册和查找时规范化路径", () => {
    const router = new Router();
    const handler = () => {};

    router.add("GET", "users/profile/", handler);

    expect(router.find("GET", "/users/profile")?.handler).toBe(handler);
    expect(router.find("GET", "/users/profile/")?.handler).toBe(handler);
  });

  it("UT-ROUTE-08 方法匹配忽略大小写", () => {
    const router = new Router();
    const handler = () => {};

    router.add("get", "/users", handler);

    expect(router.find("GET", "/users")?.handler).toBe(handler);
    expect(router.find("get", "/users")?.handler).toBe(handler);
  });

  it("UT-ROUTE-09 参数路由优先于通配符路由", () => {
    const router = new Router();
    const paramHandler = () => {};
    const wildcardHandler = () => {};

    router.add("GET", "/files/:name", paramHandler);
    router.add("GET", "/files/*", wildcardHandler);

    const match = router.find("GET", "/files/readme.md");

    expect(match?.handler).toBe(paramHandler);
    expect(match?.params).toEqual({ name: "readme.md" });
  });

  it("UT-ROUTE-10 解码参数和通配符", () => {
    const router = new Router();
    const paramHandler = () => {};
    const wildcardHandler = () => {};

    router.add("GET", "/users/:id", paramHandler);
    router.add("GET", "/static/*", wildcardHandler);

    expect(router.find("GET", "/users/a%20b")?.params).toEqual({ id: "a b" });
    expect(router.find("GET", "/static/a%20b/c%2Fd.js")?.params).toEqual({ "*": "a b/c/d.js" });
  });

  it("UT-ROUTE-11 非法编码参数不会导致路由查找抛错", () => {
    const router = new Router();
    const handler = () => {};

    router.add("GET", "/users/:id", handler);

    const match = router.find("GET", "/users/%E0%A4%A");

    expect(match?.handler).toBe(handler);
    expect(match?.params).toEqual({ id: "%E0%A4%A" });
  });

  it("UT-ROUTE-12 同一路径支持多个方法并返回允许方法列表", () => {
    const router = new Router();
    const getHandler = () => {};
    const postHandler = () => {};

    router.add("GET", "/users", getHandler);
    router.add("POST", "/users", postHandler);

    expect(router.find("GET", "/users")?.handler).toBe(getHandler);
    expect(router.find("POST", "/users")?.handler).toBe(postHandler);
    expect(router.findAllowedMethods("/users").sort()).toEqual(["GET", "POST"]);
  });

  it("UT-ROUTE-13 支持注册扩展 HTTP 方法并统一规范为大写", () => {
    const router = new Router();
    const handler = () => {};

    router.add("propfind", "/files", handler);

    expect(router.find("PROPFIND", "/files")?.handler).toBe(handler);
    expect(router.find("propfind", "/files")?.handler).toBe(handler);
    expect(router.findAllowedMethods("/files")).toEqual(["PROPFIND"]);
    expect(router.routes).toEqual([{ method: "PROPFIND", path: "/files" }]);
  });
});
