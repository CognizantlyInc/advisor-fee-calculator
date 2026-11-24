/*!
 * Advisor Fee Calculator · Prof of Wall Street
 * Shows what an investor's all-in fees cost over time, against a low-cost
 * option in a chosen benchmark. Runs entirely in the visitor's browser:
 * nothing typed is sent anywhere.
 *
 * Works on any page (built for Webflow). Elements are found by data attributes;
 * see README.md for the full list.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Assumptions. Illustrative long-run estimates, not forecasts.
  //    On Webflow these can be overridden from a CMS Collection by putting
  //    data-return / data-fee / data-label / data-note on each benchmark button.
  // ---------------------------------------------------------------------------
  var DEFAULTS = {
    inflation: 0.02,
    benchmarks: {
      sp:   { name: 'S&P 500',         label: 'an S&P 500 ETF',              ret: 0.07,  fee: 0.0009, note: 'For all-equity mandates focused on large U.S. companies.' },
      qqq:  { name: 'NASDAQ-100',      label: 'a NASDAQ-100 ETF (QQQ)',      ret: 0.08,  fee: 0.0020, note: 'For growth mandates concentrated in U.S. technology. Higher expected return, with larger swings.' },
      bal:  { name: '60/40 portfolio', label: 'a 60/40 balanced ETF',        ret: 0.055, fee: 0.0022, note: 'For balanced or more risk-averse mandates with a fixed income allocation.' },
      cash: { name: 'Cash',            label: 'a high-interest savings ETF', ret: 0.03,  fee: 0.0011, note: 'For capital-preservation mandates. Shows what fees cost against the safest option.' }
    },
    defaultBenchmark: 'sp'
  };

  // ---------------------------------------------------------------------------
  // 2. The math. Pure function: same inputs always give the same outputs.
  //    Each year: grow at the return before fees, then take the fee.
  //    No further deposits or withdrawals.
  // ---------------------------------------------------------------------------
  function calculate(input) {
    var balance = Math.max(0, num(input.balance));
    var fee = clamp(num(input.feePct) / 100, 0, 0.2);          // 2 -> 0.02
    var years = Math.round(clamp(num(input.years), 1, 50));
    var ret = num(input.benchmark.ret);
    var lowFee = num(input.benchmark.fee);
    var inflation = input.inflation == null ? DEFAULTS.inflation : num(input.inflation);

    var valueAtFee = balance * Math.pow((1 + ret) * (1 - fee), years);
    var valueAtLowCost = balance * Math.pow((1 + ret) * (1 - lowFee), years);
    var feesPaid = 0, v = balance;
    for (var i = 0; i < years; i++) { v = v * (1 + ret); feesPaid += v * fee; v = v * (1 - fee); }
    var gap = Math.max(0, valueAtLowCost - valueAtFee);

    return {
      balance: balance, feeRate: fee, years: years,
      feeThisYear: balance * fee,
      valueAtFee: valueAtFee,
      valueAtLowCost: valueAtLowCost,
      feesPaid: feesPaid,
      gap: gap,
      gapTodayDollars: gap / Math.pow(1 + inflation, years)
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Formatting
  // ---------------------------------------------------------------------------
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(x) {
    var s = (Math.round(x * 10000) / 100).toFixed(2);
    return s.replace(/\.?0+$/, '') + '%';
  }
  function num(x) { var n = parseFloat(String(x == null ? '' : x).replace(/[$,\s%]/g, '')); return isFinite(n) ? n : 0; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  // ---------------------------------------------------------------------------
  // 4. Page wiring
  // ---------------------------------------------------------------------------
  function readBenchmark(btn) {
    var id = btn.getAttribute('data-calc-benchmark');
    var base = DEFAULTS.benchmarks[id] || {};
    function attr(name, fallback, isNum) {
      var v = btn.getAttribute(name);
      if (v == null || v === '') return fallback;
      return isNum ? num(v) / 100 : v;  // entered as percent: "7" = 7%, "0.09" = 0.09%
    }
    return {
      id: id,
      name: attr('data-name', base.name || id),
      label: attr('data-label', base.label || id),
      ret: attr('data-return', base.ret, true),
      fee: attr('data-fee', base.fee, true),
      note: attr('data-note', base.note || '')
    };
  }

  function init(root) {
    if (!root || root.__feeCalc) return;
    root.__feeCalc = true;

    var q = function (sel) { return root.querySelector(sel); };
    var inputs = {
      balance: q('[data-calc="balance"]'),
      fee: q('[data-calc="fee"]'),
      years: q('[data-calc="years"]')
    };
    var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-calc-benchmark]'));
    var selected = root.getAttribute('data-calc-default') || DEFAULTS.defaultBenchmark;

    // Webflow puts inputs inside a Form block. Stop Enter from submitting it.
    var form = root.closest ? root.closest('form') : null;
    if (!form && inputs.balance && inputs.balance.form) form = inputs.balance.form;
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); });

    function currentBenchmark() {
      var btn = buttons.filter(function (b) { return b.getAttribute('data-calc-benchmark') === selected; })[0];
      if (btn) return readBenchmark(btn);
      var d = DEFAULTS.benchmarks[selected] || DEFAULTS.benchmarks[DEFAULTS.defaultBenchmark];
      return { id: selected, name: d.name, label: d.label, ret: d.ret, fee: d.fee, note: d.note };
    }

    function set(name, text) {
      var nodes = root.querySelectorAll('[data-calc-out="' + name + '"]');
      for (var i = 0; i < nodes.length; i++) nodes[i].textContent = text;
    }

    function update() {
      var bm = currentBenchmark();
      var r = calculate({
        balance: inputs.balance ? inputs.balance.value : 0,
        feePct: inputs.fee ? inputs.fee.value : 0,
        years: inputs.years ? inputs.years.value : 20,
        benchmark: bm,
        inflation: root.getAttribute('data-calc-inflation')
      });
      buttons.forEach(function (b) {
        var on = b.getAttribute('data-calc-benchmark') === selected;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      set('fee-this-year', money(r.feeThisYear));
      set('value-at-fee', money(r.valueAtFee));
      set('value-at-low-cost', money(r.valueAtLowCost));
      set('fees-paid', money(r.feesPaid));
      set('gap', money(r.gap));
      set('gap-today', money(r.gapTodayDollars));
      set('years', String(r.years));
      set('benchmark-name', bm.name);
      set('benchmark-label', bm.label);
      set('benchmark-fee', pct(bm.fee));
      set('benchmark-return', pct(bm.ret));
      set('benchmark-note', bm.note);
      root.setAttribute('data-calc-state', r.gap > 0 ? 'has-result' : 'empty');
      if (typeof global.CustomEvent === 'function') {
        root.dispatchEvent(new CustomEvent('feecalc:update', { detail: { result: r, benchmark: bm.id }, bubbles: true }));
      }
    }

    Object.keys(inputs).forEach(function (k) {
      if (inputs[k]) { inputs[k].addEventListener('input', update); inputs[k].addEventListener('change', update); }
    });
    buttons.forEach(function (b) {
      if (b.tagName === 'BUTTON' && !b.getAttribute('type')) b.setAttribute('type', 'button');
      b.addEventListener('click', function (e) { e.preventDefault(); selected = b.getAttribute('data-calc-benchmark'); update(); });
    });
    update();
  }

  function initAll() {
    var roots = document.querySelectorAll('[data-calc-root]');
    for (var i = 0; i < roots.length; i++) init(roots[i]);
  }

  var api = { calculate: calculate, init: init, initAll: initAll, defaults: DEFAULTS, format: { money: money, pct: pct } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PWSFeeCalc = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
    else initAll();
  }
})(typeof window !== 'undefined' ? window : globalThis);
