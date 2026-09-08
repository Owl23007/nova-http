import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export async function runAutocannon(config, scenario, runDuration) {
  // autocannon 使用 JSON 输出，runner 再统一归一化成项目关心的指标表
  const { stdout } = await runCommand(
    process.execPath,
    buildAutocannonArgs(config, scenario, runDuration),
    { env: process.env },
  );
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error(`[stress] autocannon returned empty output for ${scenario.name}`);
  }

  return JSON.parse(trimmed);
}

function buildAutocannonArgs(config, scenario, runDuration) {
  const args = [
    resolveNpmCli(),
    "exec",
    "--yes",
    "autocannon",
    "--",
    "-j",
    "-d",
    String(runDuration),
    "-c",
    String(config.connections),
    "-p",
    String(config.pipelining),
    "-m",
    scenario.method,
  ];

  for (const [key, value] of Object.entries(scenario.headers || {})) {
    args.push("-H", `${key}=${value}`);
  }

  if (scenario.body) {
    args.push("-b", scenario.body);
  }

  args.push(`${config.baseUrl}${scenario.path}`);
  return args;
}

function resolveNpmCli() {
  // 通过 npm exec 调用 autocannon，避免要求用户全局安装压测工具
  const candidate = path.resolve(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  if (fs.existsSync(candidate)) return candidate;

  try {
    return require.resolve("npm/bin/npm-cli.js");
  } catch (error) {
    throw new Error("[stress] npm-cli.js not found; cannot run autocannon via npm exec", {
      cause: error,
    });
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          [
            `[stress] command failed: ${command} ${args.join(" ")}`,
            `[stress] exit code: ${code}`,
            stderr.trim() || "(no stderr)",
          ].join("\n"),
        ),
      );
    });
  });
}
