import { readFile, writeFile, mkdir } from "node:fs/promises";
import { assess } from "../src/core/forecast";
import { makeRecord } from "../src/demo/fixtures";
import { hash } from "../src/core/ledger";
import { STATES, type State } from "../src/core/model";
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["eval/cases.json", "eval/secondary.json"];
const matrix = Object.fromEntries(
  STATES.map((s) => [s, Object.fromEntries(STATES.map((t) => [t, 0]))]),
) as Record<State, Record<State, number>>;
let total = 0;
const failures: unknown[] = [];
const hashes: Record<string, string> = {};
for (const file of files) {
  const cases = JSON.parse(await readFile(file, "utf8")) as {
    id: string;
    patch: Record<string, unknown>;
    expected: State;
  }[];
  hashes[file] = await hash(cases);
  for (const c of cases) {
    const f = makeRecord(c.patch);
    const actual = assess(f.promise, f.works, f.now).state;
    total++;
    matrix[c.expected][actual]++;
    if (actual !== c.expected)
      failures.push({ id: c.id, expected: c.expected, actual });
  }
}
await mkdir("eval/reports", { recursive: true });
const result = {
  total,
  correct: total - failures.length,
  matrix,
  failures,
  hashes,
  scope:
    "Authored synthetic forecast conformance cases, not a blind accuracy or customer-impact study.",
};
await writeFile(
  "eval/reports/forecast.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  `${result.correct}/${total} forecast cases agree with frozen labels`,
);
if (failures.length) {
  console.error(failures);
  process.exitCode = 1;
}
