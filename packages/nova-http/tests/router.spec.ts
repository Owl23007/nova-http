import { describe, expect, it } from "vitest";
import { Router } from "../src/core/Router";

describe("Router", () => {
  it("UT-ROUTE-01 matches a static route", () => {
    const router = new Router();
    const staticHandler = () => {};

    router.add("GET", "/users/profile", staticHandler);

    expect(router.find("GET", "/users/profile")?.handler).toBe(staticHandler);
  });

  it("UT-ROUTE-02 matches a parameter route", () => {
    const router = new Router();
    const paramHandler = () => {};

    router.add("GET", "/users/:id", paramHandler);

    const match = router.find("GET", "/users/1001");

    expect(match?.handler).toBe(paramHandler);
    expect(match?.params).toEqual({ id: "1001" });
  });

  it("UT-ROUTE-03 matches a wildcard route", () => {
    const router = new Router();
    const wildcardHandler = () => {};

    router.add("GET", "/static/*", wildcardHandler);

    const match = router.find("GET", "/static/a/b.js");

    expect(match?.handler).toBe(wildcardHandler);
    expect(match?.params).toEqual({ "*": "a/b.js" });
  });

  it("UT-ROUTE-04 gives static routes priority over parameters and wildcards", () => {
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

  it("UT-ROUTE-05 reports allowed methods when the path matches but method does not", () => {
    const router = new Router();
    router.add("GET", "/users", () => {});

    expect(router.find("POST", "/users")).toBeNull();
    expect(router.findAllowedMethods("/users")).toEqual(["GET"]);
  });
});
