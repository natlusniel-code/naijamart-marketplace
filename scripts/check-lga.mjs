/**
 * Guards the Nigeria LGA dataset in `src/lib/nigeria.ts`.
 *
 * Run with `npm run check:lga` (also wired into `npm test`).
 *
 * Why this exists: the honest failure mode for a static list like this is that
 * somebody edits it and quietly drops rows — a state nested under the wrong
 * key, a row deleted during a merge, a typo that duplicates one LGA and loses
 * another. None of that produces a type error, and none of it is visible in the
 * UI until a seller in that LGA finds an empty dropdown.
 *
 * So the checks are structural, not cosmetic:
 *   - the total is exactly 774
 *   - each state holds exactly its INEC-published count
 *   - no duplicates within a state, and no blank/whitespace names
 *   - every state in NIGERIA_STATES has an entry, and vice versa
 *   - every LGA is a valid location via `isValidLocation`
 *
 * TypeScript is already a devDependency, so the test transpiles the real module
 * rather than duplicating the data. There is exactly one copy of the list.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "src/lib/nigeria.ts");

const tmp = mkdtempSync(join(tmpdir(), "lga-check-"));
const compiledPath = join(tmp, "nigeria.mjs");

try {
  const source = readFileSync(sourcePath, "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
    fileName: "nigeria.ts",
  });

  if (diagnostics?.length) {
    const fatal = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (fatal.length) {
      console.error("✗ nigeria.ts does not compile:");
      for (const d of fatal) console.error("   ", ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      process.exit(1);
    }
  }

  writeFileSync(compiledPath, outputText);
  const mod = await import(`file://${compiledPath}?t=${Date.now()}`);

  const { NIGERIA_STATES, LGA_BY_STATE, EXPECTED_LGA_COUNTS, TOTAL_LGAS, lgasFor, isValidLocation } = mod;

  const failures = [];
  const fail = (msg) => failures.push(msg);

  // 1. Shape of the two key sets.
  const stateList = [...NIGERIA_STATES];
  const dataKeys = Object.keys(LGA_BY_STATE);
  for (const s of stateList) {
    if (!LGA_BY_STATE[s]) fail(`state "${s}" has no LGA entry`);
  }
  for (const k of dataKeys) {
    if (!stateList.includes(k)) fail(`LGA_BY_STATE has key "${k}" that is not in NIGERIA_STATES`);
  }
  const countKeys = Object.keys(EXPECTED_LGA_COUNTS);
  for (const s of stateList) {
    if (!countKeys.includes(s)) fail(`EXPECTED_LGA_COUNTS is missing "${s}"`);
  }
  if (stateList.length !== 37) fail(`expected 37 states (36 + FCT), got ${stateList.length}`);

  // 2. Per-state counts against INEC, and internal hygiene.
  let total = 0;
  for (const state of stateList) {
    const list = LGA_BY_STATE[state] ?? [];
    total += list.length;

    const expected = EXPECTED_LGA_COUNTS[state];
    if (expected !== undefined && list.length !== expected) {
      fail(`${state}: ${list.length} LGAs, INEC publishes ${expected}`);
    }

    const seen = new Set();
    for (const name of list) {
      if (typeof name !== "string" || !name.trim()) {
        fail(`${state}: blank or non-string LGA entry`);
        continue;
      }
      if (name !== name.trim() || /\s{2,}/.test(name)) {
        fail(`${state}: "${name}" has stray whitespace`);
      }
      if (seen.has(name)) fail(`${state}: duplicate LGA "${name}"`);
      seen.add(name);
    }
  }

  // 3. The headline number.
  if (total !== TOTAL_LGAS) fail(`total LGAs is ${total}, expected ${TOTAL_LGAS}`);
  if (total !== 774) fail(`total LGAs is ${total}, expected 774`);

  // 4. The helpers actually resolve, and reject nonsense.
  for (const state of stateList) {
    const list = lgasFor(state);
    if (!list.length) fail(`lgasFor("${state}") returned nothing`);
    if (list.length !== LGA_BY_STATE[state].length) fail(`lgasFor("${state}") length mismatch`);
    const first = list[0];
    if (!isValidLocation(state, first)) fail(`isValidLocation("${state}", "${first}") returned false`);
    if (isValidLocation(state, "Definitely Not An LGA")) fail(`isValidLocation accepted a bogus LGA for ${state}`);
  }
  if (lgasFor(null).length !== 0) fail("lgasFor(null) should be empty");
  if (lgasFor("Atlantis").length !== 0) fail('lgasFor("Atlantis") should be empty');

  // 5. Spot-check the count extremes, which are the easiest to get wrong.
  const extremes = { Kano: 44, Katsina: 34, Oyo: 33, "Akwa Ibom": 31, Osun: 30, FCT: 6, Bayelsa: 8, Nasarawa: 13 };
  for (const [state, want] of Object.entries(extremes)) {
    const got = (LGA_BY_STATE[state] ?? []).length;
    if (got !== want) fail(`${state}: ${got} LGAs, expected ${want}`);
  }

  // 6. Named LGAs from the bug report must exist.
  const named = [
    ["Oyo", "Oyo East"],
    ["Oyo", "Ibadan North"],
    ["Ogun", "Abeokuta North"],
    ["Lagos", "Ikeja"],
    ["Benue", "Makurdi"],
    ["Enugu", "Nsukka"],
    ["FCT", "Abuja Municipal (AMAC)"],
  ];
  for (const [state, lga] of named) {
    if (!isValidLocation(state, lga)) fail(`expected ${state} to contain "${lga}"`);
  }

  if (failures.length) {
    console.error(`✗ LGA dataset check failed — ${failures.length} problem(s):`);
    for (const f of failures) console.error("   -", f);
    process.exit(1);
  }

  console.log(`✓ LGA dataset OK — ${total} LGAs across ${stateList.length} states (INEC counts match).`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
