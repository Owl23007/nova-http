import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

const frameworkPackage = readJson("packages/nova-http/package.json");
const initializerPackage = readJson("packages/create-nova-http/package.json");
const changesetsConfig = readJson(".changeset/config.json");
const runtimeNodeRange = ">=20.0.0";

assert.equal(readJson("package.json").engines.node, "^22.22.1 || ^24.0.0");

assert.equal(
  initializerPackage.version,
  frameworkPackage.version,
  `Package versions must match: nova-http=${frameworkPackage.version}, create-nova-http=${initializerPackage.version}`,
);

const fixedTogether = changesetsConfig.fixed.some(
  (group) => group.includes("nova-http") && group.includes("create-nova-http"),
);
assert.ok(
  fixedTogether,
  "nova-http and create-nova-http must belong to one fixed Changesets group",
);

assert.equal(frameworkPackage.engines.node, runtimeNodeRange);
assert.equal(initializerPackage.engines.node, runtimeNodeRange);

for (const template of ["minimal", "minimal-js", "api", "api-js"]) {
  const templatePackage = readJson(`packages/nova-http/cli/templates/${template}/package.json`);
  assert.equal(
    templatePackage.engines.node,
    runtimeNodeRange,
    `${template} template must use the published runtime Node.js range`,
  );
  if (templatePackage.devDependencies?.["@types/node"]) {
    assert.equal(
      templatePackage.devDependencies["@types/node"],
      "^20.0.0",
      `${template} template must use the runtime baseline Node.js types`,
    );
  }
}

for (const fileName of ["README.md", "LICENSE", "CHANGELOG.md"]) {
  assert.ok(
    fs.existsSync(path.join(rootDir, "packages/create-nova-http", fileName)),
    `create-nova-http is missing ${fileName}`,
  );
  assert.ok(
    initializerPackage.files.includes(fileName),
    `create-nova-http package files must include ${fileName}`,
  );
}

console.log(`Release packages are synchronized at ${frameworkPackage.version}.`);
