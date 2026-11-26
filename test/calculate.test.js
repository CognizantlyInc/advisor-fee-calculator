// Run with: npm test   (Node 18+, no dependencies)
// Checks the math against independently computed values, so changes can't
// silently alter results. Add a case here whenever an assumption changes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const calc = require('../src/fee-calculator.js');

const sp = calc.defaults.countries.us.benchmarks.sp;
const spCad = calc.defaults.countries.ca.benchmarks.sp;   // 0.09%, as in the sample report
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('$1M, 2% fee, 20 years, S&P 500 benchmark', () => {
  const r = calc.calculate({ balance: 1000000, feePct: 2, years: 20, benchmark: sp });
  near(r.valueAtFee, 1000000 * Math.pow(1.07 * 0.98, 20));
  near(r.valueAtLowCost, 1000000 * Math.pow(1.07 * (1 - sp.fee), 20));
  near(r.gap, r.valueAtLowCost - r.valueAtFee);
  near(r.gapTodayDollars, r.gap / Math.pow(1.02, 20));
  near(r.feeThisYear, 20000);
});

test('matches the brochure HNW projection ($1.92M at 2.2% vs 0.09%, 20y)', () => {
  // From the sample report: $4.76M vs $7.30M, gap $2.54M, $1.71M in today's dollars.
  const r = calc.calculate({ balance: 1920807, feePct: 2.2, years: 20, benchmark: spCad });
  near(r.valueAtFee, 4763613, 5);
  near(r.valueAtLowCost, 7300264, 5);
  near(r.gap, 2536651, 10);
  near(r.gapTodayDollars, 1707101, 10);
});

test('fees paid adds each year\'s fee', () => {
  const r = calc.calculate({ balance: 100000, feePct: 1, years: 2, benchmark: { ret: 0.1, fee: 0 } });
  // Year 1: 110,000 -> fee 1,100 -> 108,900. Year 2: 119,790 -> fee 1,197.90
  near(r.feesPaid, 1100 + 1197.9, 0.01);
});

test('no gap when the fee equals the low-cost fee', () => {
  const r = calc.calculate({ balance: 500000, feePct: sp.fee * 100, years: 20, benchmark: sp });
  near(r.gap, 0, 0.5);
});

test('bad input is handled safely', () => {
  const r = calc.calculate({ balance: '$1,000,000', feePct: '', years: 999, benchmark: sp });
  assert.equal(r.years, 50);
  assert.equal(r.feeRate, 0);
  near(r.gap, 0, 0.5);
  const neg = calc.calculate({ balance: -5, feePct: 2, years: 0, benchmark: sp });
  assert.equal(neg.balance, 0);
  assert.equal(neg.years, 1);
});

test('formatting', () => {
  assert.equal(calc.format.money(1234567.6), '$1,234,568');
  assert.equal(calc.format.pct(0.0009), '0.09%');
  assert.equal(calc.format.pct(0.07), '7%');
  assert.equal(calc.format.pct(0.055), '5.5%');
});

test('both countries are set up with valid benchmarks', () => {
  const { countries, defaultCountry } = calc.defaults;
  assert.equal(defaultCountry, 'us');
  assert.deepEqual(Object.keys(countries).sort(), ['ca', 'us']);
  for (const [code, c] of Object.entries(countries)) {
    assert.ok(c.benchmarks[c.defaultBenchmark], code + ' default benchmark exists');
    for (const [id, b] of Object.entries(c.benchmarks)) {
      assert.ok(b.ret > 0 && b.ret < 0.15, `${code}.${id} return looks sane`);
      assert.ok(b.fee >= 0 && b.fee < 0.01, `${code}.${id} fee looks sane`);
      assert.ok(b.name && b.label && b.note, `${code}.${id} has text`);
    }
  }
  assert.equal(countries.us.currency, 'US$');
  assert.equal(countries.ca.currency, 'C$');
});

test('historical returns are set for every benchmark and match sources', () => {
  const { countries, defaultMode, modes } = calc.defaults;
  assert.equal(defaultMode, 'historical');
  assert.ok(modes.historical && modes.conservative);
  const expected = { us: { sp: 0.100, qqq: 0.1425, bal: 0.078, cash: 0.034 },
                     ca: { tsx: 0.105, sp: 0.100, bal: 0.089, cash: 0.047 } };
  for (const [code, set] of Object.entries(expected)) {
    for (const [id, hist] of Object.entries(set)) {
      const b = countries[code].benchmarks[id];
      assert.equal(b.hist, hist, `${code}.${id} historical return`);
      assert.ok(b.histPeriod, `${code}.${id} has a period`);
      assert.ok(b.hist > b.ret, `${code}.${id} historical is above conservative`);
    }
  }
});

test('higher assumed return makes the cost of fees larger', () => {
  const lo = calc.calculate({ balance: 1e6, feePct: 2, years: 20, benchmark: { ret: 0.07, fee: 0.0003 } });
  const hi = calc.calculate({ balance: 1e6, feePct: 2, years: 20, benchmark: { ret: 0.10, fee: 0.0003 } });
  assert.ok(hi.gap > lo.gap);
});

// ---- Optional past-performance comparison ----
test('trailing returns match the published 1/3/5/10-year figures', () => {
  const vfv = calc.defaults.countries.ca.benchmarks.sp;      // VFV MRFP: 12.23, 23.21, 15.83, 14.34
  const xbal = calc.defaults.countries.ca.benchmarks.bal;    // XBAL MRFP: 13.33, 14.07, 7.95, 7.70
  [[vfv, [12.23, 23.21, 15.83, 14.34]], [xbal, [13.33, 14.07, 7.95, 7.70]]].forEach(([b, want]) => {
    [1, 3, 5, 10].forEach((n, i) => near(calc.trailing(b, n) * 100, want[i], 0.02));
  });
});

test('blank or invalid past return means no comparison', () => {
  for (const v of ['', '  ', 'abc', null, undefined]) {
    assert.equal(calc.comparePast({ pastReturnPct: v, pastYears: 5, feePct: 2, benchmark: sp, balance: 1e6, years: 20 }), null);
  }
});

test('gap splits into fees and investing, and adds up', () => {
  const p = calc.comparePast({ pastReturnPct: '7', pastYears: 5, pastBasis: 'after', feePct: 2, benchmark: { ...sp, ret: 0.10 }, balance: 1e6, years: 20 });
  near(p.benchNet * 100, 14.41, 0.02);
  near(p.totalGap, p.feeGap + p.investingGap, 1e-12);
  assert.ok(p.investingGap > 0 && p.feeGap > 0 && !p.beat);
  // Costs more than fees alone, because the investing gap continues.
  const feesOnly = calc.calculate({ balance: 1e6, feePct: 2, years: 20, benchmark: { ret: 0.10, fee: sp.fee } }).gap;
  assert.ok(p.cost > feesOnly);
});

test('before-fee input is converted, and beating the benchmark is reported', () => {
  const p = calc.comparePast({ pastReturnPct: '17', pastYears: 5, pastBasis: 'before', feePct: 1, benchmark: { ...sp, ret: 0.10 }, balance: 1e6, years: 20 });
  near(p.userNet, 1.17 * 0.99 - 1, 1e-12);
  assert.ok(p.beat);
});

test('with no investing gap, the cost equals the fees-only result', () => {
  const b = { ...sp, ret: 0.10 };
  const bench = calc.trailing(b, 5);
  const gross = (1 + bench) / (1 - sp.fee) - 1;
  const p = calc.comparePast({ pastReturnPct: String(((1 + gross) * 0.98 - 1) * 100), pastYears: 5, feePct: 2, benchmark: b, balance: 1e6, years: 20 });
  const feesOnly = calc.calculate({ balance: 1e6, feePct: 2, years: 20, benchmark: { ret: 0.10, fee: sp.fee } }).gap;
  near(p.cost, feesOnly, 1);
});
