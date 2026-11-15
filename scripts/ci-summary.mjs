// Writes the test, coverage and evaluation figures as Markdown for the CI run page.
// Usage: node scripts/ci-summary.mjs >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const pct = (m) => `${m.pct.toFixed(1)} %`;

const tests = read("coverage/tests.json");
const coverage = read("coverage/coverage-summary.json");
const forecast = read("eval/reports/forecast.json");

const lines = [
  "## Kept verification",
  "",
  "| Check | Result |",
  "|---|---|",
  `| Unit tests, random order | ${tests.numPassedTests} of ${tests.numTotalTests} passed |`,
  `| Labelled forecast cases | ${forecast.correct} of ${forecast.total} match |`,
  `| Decision core coverage, lines | ${pct(coverage.total.lines)} |`,
  `| Decision core coverage, branches | ${pct(coverage.total.branches)} |`,
  "",
  "### Coverage of `src/core`",
  "",
  "| Module | Lines | Branches | Functions |",
  "|---|---:|---:|---:|",
  ...Object.entries(coverage)
    .filter(([file]) => file !== "total")
    .map(
      ([file, m]) =>
        `| ${basename(file)} | ${pct(m.lines)} | ${pct(m.branches)} | ${pct(m.functions)} |`,
    ),
];
console.log(lines.join("\n"));
