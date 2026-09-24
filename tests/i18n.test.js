import { test } from "node:test";
import assert from "node:assert/strict";

import { _setLangForTests, fmtFixed, fmtNumber, pct, plural } from "../js/i18n.js";
import { t } from "../js/strings.js";

const placeholders = (value) =>
  typeof value === "string" ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : null;

/** Every translation table must have the same keys and placeholders in both languages. */
export function checkTable(name, table) {
  const en = Object.keys(table.en).sort();
  const ru = Object.keys(table.ru).sort();
  assert.deepEqual(
    en.filter((k) => !table.ru[k]),
    [],
    `${name}: keys missing in Russian`,
  );
  assert.deepEqual(
    ru.filter((k) => !table.en[k]),
    [],
    `${name}: Russian keys without English`,
  );
  for (const k of en) {
    const a = placeholders(table.en[k]);
    const b = placeholders(table.ru[k]);
    if (a && b) assert.deepEqual(b, a, `${name}: placeholders differ for "${k}"`);
  }
}

test("core strings are complete in Russian", () => {
  checkTable("strings.js", t.table);
});

test("Russian plurals and numbers", () => {
  _setLangForTests("ru");
  const forms = { one: "{n} оборот", few: "{n} оборота", many: "{n} оборотов", other: "{n} оборота" };
  assert.equal(plural(1, forms), "1 оборот");
  assert.equal(plural(3, forms), "3 оборота");
  assert.equal(plural(11, forms), "11 оборотов");
  assert.equal(plural(21, forms), "21 оборот");
  assert.equal(plural(2.5, forms), "2,5 оборота");
  assert.equal(fmtFixed(0.66, 2), "0,66");
  assert.equal(pct("25"), "25 %");
  assert.match(fmtNumber(83000), /^83\s000$/u);
  _setLangForTests("en");
  assert.equal(fmtFixed(0.66, 2), "0.66");
  assert.equal(pct("25"), "25%");
  assert.equal(fmtNumber(83000), "83,000");
  assert.equal(plural(1, { one: "{n} orbit", other: "{n} orbits" }), "1 orbit");
});

test("interpolation and function values", () => {
  _setLangForTests("ru");
  assert.equal(t("sr.balanced", { name: "L4" }), "Равновесие в L4.");
  assert.equal(t("find.left", { n: 3 }), "Осталось найти: 3.");
  _setLangForTests("en");
  assert.equal(t("sr.balanced", { name: "L4" }), "Balanced at L4.");
});

test("every module's strings are complete in Russian", async () => {
  const modules = [
    ["../js/chapters/triangle.js", "TRIANGLE_STRINGS"],
    ["../js/chapters/line.js", "LINE_STRINGS"],
    ["../js/chapters/real.js", "REAL_STRINGS"],
    ["../js/chapters/letgo.js", "LETGO_STRINGS"],
    ["../js/features/realscale.js", "REALSCALE_STRINGS"],
    ["../js/features/release.js", "RELEASE_STRINGS"],
    ["../js/features/realmotion.js", "REALMOTION_STRINGS"],
  ];
  for (const [path, name] of modules) {
    const mod = await import(path);
    assert.ok(mod[name], `${path} exports ${name}`);
    checkTable(name, mod[name]);
  }
});

test("Russian orbit counts use the right plural", async () => {
  const { formatOrbits, describeOutcome } = await import("../js/features/release.js");
  _setLangForTests("ru");
  assert.equal(formatOrbits(1), "1 оборот");
  assert.equal(formatOrbits(3), "3 оборота");
  assert.equal(formatOrbits(12.4), "12 оборотов");
  assert.equal(formatOrbits(3.13), "3,1 оборота");
  assert.equal(describeOutcome("escaped", 3.13, "L4"), "Улетел через 3,1 оборота.");
  _setLangForTests("en");
  assert.equal(describeOutcome("escaped", 3.13, "L4"), "Flew off after 3.1 orbits.");
});
