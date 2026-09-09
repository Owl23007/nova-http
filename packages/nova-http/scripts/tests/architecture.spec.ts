import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");

describe("architecture dependency rules", () => {
  it("keeps core hooks independent from external event owners", () => {
    const source = readFileSync(join(sourceRoot, "core/hooks.ts"), "utf8");
    const relativeImports = [...source.matchAll(/from\s+["'](\.[^"']+)["']/g)].map(
      (match) => match[1],
    );
    expect(relativeImports).toEqual(["./request", "./response"]);
  });

  it("keeps the application kernel independent from protocol and server adapters", () => {
    expect(
      findForbiddenImports("core", ["protocol", "server", "net", "fs", "fs/promises"]),
    ).toEqual([]);
  });

  it("keeps HTTP/1 independent from the application kernel and Node transport", () => {
    expect(findForbiddenImports("protocol/http1", ["core", "server", "net"])).toEqual([]);
  });

  it("keeps message contracts independent from inward and outward adapters", () => {
    expect(
      findForbiddenImports("message", ["core", "protocol", "server", "net", "fs", "fs/promises"]),
    ).toEqual([]);
  });

  it("keeps the composition facade free of direct Node transport imports", () => {
    expect(findForbiddenImports("app", ["net", "fs", "fs/promises"])).toEqual([]);
  });
});

function findForbiddenImports(layer: string, forbidden: readonly string[]): string[] {
  const violations: string[] = [];
  for (const file of sourceFiles(join(sourceRoot, layer))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const specifier = match[1].replaceAll("\\", "/");
      const violates = forbidden.some(
        (name) =>
          specifier === name || specifier.startsWith(`${name}/`) || specifier.includes(`/${name}/`),
      );
      if (violates) violations.push(`${relative(sourceRoot, file)} -> ${specifier}`);
    }
  }
  return violations;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && path.endsWith(".ts")) files.push(path);
  }
  return files;
}
