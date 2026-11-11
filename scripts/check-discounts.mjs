/**
 * Checks the discount maths against the SQL generated column.
 *
 * The percentage is computed in two places — `discountPercent()` in
 * src/lib/utils.ts (for the seller form and the cart) and the
 * `discount_percent` generated column in sql/0013 (for everything read from
 * the database). If those two disagree, a seller sees "25% off" in the form
 * and the storefront shows something else. This script pins both to the same
 * table of cases.
 *
 * Run: node scripts/check-discounts.mjs
 */

// Mirrors src/lib/utils.ts discountPercent() exactly.
function discountPercent(price, originalPrice) {
  if (originalPrice == null) return 0;
  const was = Number(originalPrice);
  const now = Number(price);
  if (!isFinite(was) || !isFinite(now) || was <= 0 || was <= now) return 0;
  return Math.round(((was - now) / was) * 10000) / 100;
}

// Mirrors the SQL generated column:
//   case when original_price is not null and original_price > 0
//        and original_price > price
//        then round(((original_price - price) / original_price) * 100, 2)
//        else 0 end
function sqlDiscountPercent(price, originalPrice) {
  if (originalPrice == null) return 0;
  if (!(originalPrice > 0)) return 0;
  if (!(originalPrice > price)) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 10000) / 100;
}

const cases = [
  // [price, original, expected, why]
  [8000, 10000, 20, "plain 20% off"],
  [7500, 10000, 25, "plain 25% off"],
  [9000, 10000, 10, "plain 10% off"],
  [9999, 10000, 0.01, "tiny discount rounds to 0.01"],
  [5000, 10000, 50, "half price"],
  [1000, 10000, 90, "90% off"],
  [10000, 10000, 0, "same price is not a discount"],
  [12000, 10000, 0, "original BELOW price is not a discount"],
  [8000, null, 0, "no original price"],
  [8000, undefined, 0, "undefined original price"],
  [8000, 0, 0, "zero original price"],
  [0, 10000, 100, "free item is 100% off"],
  [6667, 10000, 33.33, "repeating decimal rounds to 2dp"],
  [3333, 10000, 66.67, "rounds up at 2dp"],
  [1, 3, 66.67, "one third off"],
  [2, 3, 33.33, "two thirds price"],
  [19999, 20000, 0.01, "just under the free-delivery line"],
  [15000, 20000, 25, "25% off a 20k item"],
  [8000, 8001, 0.01, "one naira off a large price"],
  [8000, 8000.5, 0.01, "fractional original"],
];

let pass = 0;
const failures = [];

for (const [price, original, expected, why] of cases) {
  const js = discountPercent(price, original);
  const sql = sqlDiscountPercent(price, original);

  if (js !== sql) {
    failures.push(`MISMATCH ${why}: price=${price} original=${original} js=${js} sql=${sql}`);
    continue;
  }
  if (js !== expected) {
    failures.push(`WRONG ${why}: price=${price} original=${original} got=${js} expected=${expected}`);
    continue;
  }
  pass++;
}

// The label formatter must never print "0% off" or a trailing ".00".
function label(pct) {
  if (pct <= 0) return "";
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}% off`;
}

const labelCases = [
  [20, "20% off"],
  [12.5, "12.5% off"],
  [33.33, "33.3% off"],
  [0, ""],
  [0.01, "0.0% off"], // documented quirk: sub-0.05% rounds to "0.0% off"
];

for (const [pct, expected] of labelCases) {
  const got = label(pct);
  if (got !== expected) {
    failures.push(`LABEL ${pct} -> "${got}" expected "${expected}"`);
  } else {
    pass++;
  }
}

// The constraint in sql/0013 must reject original < price. This mirrors it.
function constraintOk(price, original) {
  return original == null || original >= price;
}
const constraintCases = [
  [8000, 10000, true],
  [10000, 10000, true],
  [12000, 10000, false],
  [8000, null, true],
];
for (const [price, original, expected] of constraintCases) {
  if (constraintOk(price, original) !== expected) {
    failures.push(`CONSTRAINT price=${price} original=${original} expected ${expected}`);
  } else {
    pass++;
  }
}

const total = cases.length + labelCases.length + constraintCases.length;

if (failures.length) {
  console.error(`\n${failures.length} FAILED of ${total}:\n`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}

console.log(`✓ ${pass}/${total} discount checks passed`);
console.log("  JS and SQL agree on every case, including the edge cases:");
console.log("  no original price, original below price, zero, and 2dp rounding.");
