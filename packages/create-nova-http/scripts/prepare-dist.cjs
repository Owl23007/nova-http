const fs = require("fs");
const path = require("path");

const sourceCliDir = path.resolve(__dirname, "..", "..", "nova-http", "dist", "cli");
const targetCliDir = path.join(__dirname, "..", "dist", "cli");

if (!fs.existsSync(sourceCliDir)) {
  console.error(`Missing ${sourceCliDir}. Run "pnpm -F nova-http run build" first.`);
  process.exit(1);
}

fs.rmSync(targetCliDir, { recursive: true, force: true });
fs.mkdirSync(targetCliDir, { recursive: true });

const filesToCopy = ["create-nova.js", "create-nova.js.map", "shared.js", "shared.js.map"];

for (const fileName of filesToCopy) {
  fs.copyFileSync(path.join(sourceCliDir, fileName), path.join(targetCliDir, fileName));
}

const sourceTemplatesDir = path.join(sourceCliDir, "templates");
const targetTemplatesDir = path.join(targetCliDir, "templates");
fs.cpSync(sourceTemplatesDir, targetTemplatesDir, { recursive: true });

console.log("Prepared dist files for create-nova-http package.");
