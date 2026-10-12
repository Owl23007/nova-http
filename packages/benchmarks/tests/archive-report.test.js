import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createArchiveReport,
  formatTargetName,
  writeArchiveReport,
} from "../report/archive-report.js";
import { summary, validateRecord } from "../report/results.js";
import { archiveBatchFixture } from "./fixtures/archive-batch.js";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

const options = {
  artifactId: 456,
  archivePath: ".benchmark/historical/http-v1/123-2/",
};

describe("benchmark archive report", () => {
  it("renders measured QPS, p99, CV and rounds in manifest order", () => {
    const report = createArchiveReport(archiveBatchFixture().files, options);

    expect(report).toContain("## Benchmark Archive");
    expect(report).toContain("This PR adds an immutable benchmark batch");
    expect(report).toContain(
      "[Run #123 (Attempt #2)](https://github.com/owner/repo/actions/runs/123/attempts/2)",
    );
    expect(report).toContain("```mermaid\nxychart-beta");
    expect(report).toContain('title "Relative throughput (Node HTTP = 100%)"');
    expect(report).toContain(
      'x-axis ["Nova", "Fastify (Schema)", "Fastify (No Schema)", "Node HTTP", "Nova (Previous Release)"]',
    );
    expect(report).toContain('y-axis "Relative QPS (%)" 0 --> 120');
    expect(report).toContain("bar [77.1, 84.73, 92.37, 100, 107.63]");
    expect(report).toContain(
      "| Target | Median QPS | vs Node HTTP | Median p99 | QPS CV | Valid rounds |",
    );
    expect(report).toContain("| Nova | 1,010 | -22.9% | 4 ms | 0.81% | 3/3 |");
    expect(report).toContain("| Node HTTP | 1,310 | +0% | 7 ms | 0.62% | 3/3 |");
    expect(report.indexOf("### Run Configuration")).toBeLessThan(report.indexOf("### Results"));
    expect(report).toContain("| Suite | `http-v1` |");
    expect(report).toContain("| Load | `pipeline-10` |");
    expect(report).toContain("| Commit | [`aaaaaaa`](https://github.com/owner/repo/commit/");
    expect(report).toContain("| Artifact ID | `456` |");
    expect(report.match(/Run #123/g)).toHaveLength(1);
    expect(report).not.toContain("n/a");
  });

  it("renders the batch summary as a concise English report", () => {
    const { files, manifest } = archiveBatchFixture();
    const records = manifest.files.map((name) => validateRecord(JSON.parse(files[name])));
    const report = summary(records);

    expect(report).toContain("# HTTP Benchmark");
    expect(report).toContain("## Run Configuration");
    expect(report).toContain("## Results");
    expect(report).toContain(
      "| Target | Median QPS | vs Nova (Previous Release) | Median p99 | QPS CV | Valid rounds |",
    );
    expect(report).toContain("| Nova | 1,010 | -28.37% | 4 ms | 0.81% | 3/3 |");
    expect(report).toContain("<summary><strong>Round details</strong></summary>");
    expect(report).toContain("## Interpretation Notes");
    expect(report).not.toMatch(/\p{Script=Han}/u);
  });

  it("writes a report by reading the archived JSON batch", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nova-archive-report-"));
    temporaryDirectories.push(directory);
    const { files } = archiveBatchFixture();
    await Promise.all(
      Object.entries(files).map(([name, content]) =>
        fs.writeFile(path.join(directory, name), content),
      ),
    );
    const outputPath = path.join(directory, "..", `${path.basename(directory)}.md`);
    temporaryDirectories.push(outputPath);

    await expect(writeArchiveReport(directory, { ...options, outputPath })).resolves.toBe(
      outputPath,
    );
    await expect(fs.readFile(outputPath, "utf8")).resolves.toContain("#### Measured Results");
  });

  it("rejects missing measurements instead of substituting a value", () => {
    const { files } = archiveBatchFixture();
    const record = JSON.parse(files["nova-current.json"]);
    delete record.rounds[0].raw.requests.average;
    files["nova-current.json"] = JSON.stringify(record);

    expect(() => createArchiveReport(files, options)).toThrow();
  });

  it("rejects malformed and incomplete input", () => {
    expect(() => createArchiveReport({ "manifest.json": "{" }, options)).toThrow();
    const { files } = archiveBatchFixture();
    delete files["node-http.json"];
    expect(() => createArchiveReport(files, options)).toThrow("Incomplete batch file set");
  });

  it("rejects archive metadata for a different batch", () => {
    expect(() =>
      createArchiveReport(archiveBatchFixture().files, {
        ...options,
        archivePath: ".benchmark/historical/http-v1/999-1/",
      }),
    ).toThrow("Invalid archive path");
  });

  it("formats known and fallback target names", () => {
    expect(formatTargetName("nova-current")).toBe("Nova");
    expect(formatTargetName("node-http")).toBe("Node HTTP");
    expect(formatTargetName("custom-server")).toBe("Custom Server");
  });
});
