/**
 * Does the GST number check actually catch a mistyped number?
 *
 * A validator that says yes to everything is worse than none, because it
 * makes a wrong number look checked. So this does not just assert that real
 * numbers pass: it takes each real number, changes one character at a time in
 * every position, and insists that nearly all of those are caught.
 *
 * The check digit is base 36, so roughly one corruption in 36 lands on a
 * number that is still self consistent. That is arithmetic, not a bug, and
 * the figure below is asserted rather than hoped for.
 *
 *     node scripts/gstin_check.js
 */
const { checkGstin, isValidGstin, gstinState } = require("../src/utils/gstin");

let fails = 0;
const check = (cond, label, v) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(52)} ${JSON.stringify(v ?? "")}`);
};

// Published examples. 27AAPFU0939F1ZV is the one in the GST documentation
// itself; the others are of the same shape and pass their own check digit.
const REAL = ["27AAPFU0939F1ZV", "24AAACC1206D1ZM", "29AAGCB7383J1Z4"];

console.log("\n=== GST number checking ===");

for (const g of REAL) {
  check(isValidGstin(g), `${g} is accepted`, checkGstin(g).stateName);
}

check(gstinState("24AAACC1206D1ZM")?.name === "Gujarat", "state comes off the first two digits", gstinState("24AAACC1206D1ZM"));
check(gstinState("27AAPFU0939F1ZV")?.code === "27", "and so does the code", gstinState("27AAPFU0939F1ZV")?.code);

// How people actually type it.
check(isValidGstin("27aapfu0939f1zv"), "lower case is accepted", {});
check(isValidGstin(" 27AAPFU0939F1ZV "), "stray spaces are accepted", {});
check(isValidGstin("27-AAPFU0939F-1ZV"), "dashes are accepted", {});

// Rubbish.
check(!isValidGstin(""), "blank is refused", {});
check(!isValidGstin(null), "null is refused", {});
check(!isValidGstin("abc"), "a word is refused", {});
check(!isValidGstin("27AAPFU0939F1Z"), "14 characters is refused", {});
check(!isValidGstin("27AAPFU0939F1ZVV"), "16 characters is refused", {});
check(!isValidGstin("00AAPFU0939F1ZV"), "state code 00 is refused", {});
check(!isValidGstin("40AAPFU0939F1ZV"), "state code 40 is refused", {});
check(!isValidGstin("27AAPFU0939F1AV"), "the fixed Z in place 14 is required", {});

// The message a person reads has to say which of these went wrong.
check(/15 characters/.test(checkGstin("27AAPFU").reason), "a short number says so", checkGstin("27AAPFU").reason);
check(/state code/.test(checkGstin("00AAPFU0939F1ZV").reason), "a bad state code says so", checkGstin("00AAPFU0939F1ZV").reason);

// The real test: change one character and it should be caught.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
let tried = 0;
let missed = 0;
for (const g of REAL) {
  for (let i = 0; i < 15; i++) {
    for (const ch of ALPHABET) {
      if (ch === g[i]) continue;
      const bad = g.slice(0, i) + ch + g.slice(i + 1);
      tried++;
      if (isValidGstin(bad)) missed++;
    }
  }
}
const caught = ((tried - missed) / tried) * 100;
check(caught > 96, `one character wrong is caught ${caught.toFixed(1)}% of the time`, { tried, missed });

// Two numbers that differ only by a swapped pair are the other common typo.
const swapped = "27AAPFU0399F1ZV"; // 0939 -> 0399
check(!isValidGstin(swapped), "swapping two digits is caught", swapped);

console.log(fails === 0 ? "\nall good\n" : `\n${fails} failure(s)\n`);
process.exitCode = fails === 0 ? 0 : 1;
