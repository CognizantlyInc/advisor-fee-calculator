/*!
 * Advisor Fee Calculator · Prof of Wall Street
 * Shows what an investor's all-in fees cost over time, against a low-cost
 * option in a chosen benchmark. US and Canada versions. Runs entirely in the
 * visitor's browser: nothing typed is sent anywhere.
 *
 * Elements are found by data attributes; see README.md for the full list.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Assumptions by country. Illustrative long-run estimates, not forecasts.
  //    Low-cost fees reflect typical index ETFs in each market (see README).
  //    Can be overridden per button with data-return / data-fee (in percent).
  // ---------------------------------------------------------------------------
  // Two return assumptions, chosen by the visitor:
  //   historical:   long-run average total returns (hist / histPeriod below)
  //   conservative: lower forward-looking estimates (ret below)
  var MODES = {
    historical:   { label: 'historical average', inflation: 0.03 },
    conservative: { label: 'conservative estimate', inflation: 0.02 }
  };

  var DEFAULTS = {
    inflation: 0.02,
    defaultMode: 'historical',
    modes: MODES,
    defaultCountry: 'us',
    countries: {
      us: {
        currency: 'US$',
        defaultBenchmark: 'sp',
        benchmarks: {
          sp:   { name: 'S&P 500',         label: 'an S&P 500 index ETF',     ret: 0.07,  hist: 0.100, histPeriod: '1928–2025', fee: 0.0003, note: 'For all-equity mandates focused on large U.S. companies.' },
          qqq:  { name: 'NASDAQ-100',      label: 'a NASDAQ-100 ETF (QQQ)',   ret: 0.08,  hist: 0.1425, histPeriod: '1985–2024', fee: 0.0020, note: 'For growth mandates concentrated in U.S. technology. Higher expected return, with larger swings.' },
          bal:  { name: '60/40 portfolio', label: 'a 60/40 balanced index fund', ret: 0.055, hist: 0.078, histPeriod: '1928–2025', fee: 0.0010, note: 'For balanced or more risk-averse mandates with a fixed income allocation.' },
          cash: { name: 'Cash',            label: 'a money market fund',      ret: 0.03,  hist: 0.034, histPeriod: '1928–2025', fee: 0.0010, note: 'For capital-preservation mandates. Shows what fees cost against the safest option.' }
        }
      },
      ca: {
        currency: 'C$',
        defaultBenchmark: 'tsx',
        benchmarks: {
          tsx:  { name: 'S&P/TSX Composite', label: 'a TSX index ETF',              ret: 0.065, hist: 0.105, histPeriod: '1976–2025', fee: 0.0006, note: 'For Canadian equity mandates.' },
          sp:   { name: 'S&P 500',           label: 'an S&P 500 index ETF in CAD',  ret: 0.07,  hist: 0.100, histPeriod: '1928–2025, in US$', fee: 0.0009, note: 'For all-equity mandates focused on large U.S. companies, held in Canadian dollars.' },
          bal:  { name: '60/40 portfolio',   label: 'a 60/40 balanced ETF',          ret: 0.055, hist: 0.089, histPeriod: '1976–2025', fee: 0.0024, note: 'For balanced or more risk-averse mandates with a fixed income allocation.' },
          cash: { name: 'Cash',              label: 'a high-interest savings ETF',   ret: 0.03,  hist: 0.047, histPeriod: '1950–2025', fee: 0.0011, note: 'For capital-preservation mandates. Shows what fees cost against the safest option.' }
        }
      }
    }
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
    var inflation = input.inflation == null || input.inflation === '' ? DEFAULTS.inflation : num(input.inflation);

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
  // 3. Helpers
  // ---------------------------------------------------------------------------
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(x) {
    var s = (Math.round(x * 10000) / 100).toFixed(2);
    return s.replace(/\.?0+$/, '') + '%';
  }
  function num(x) { var n = parseFloat(String(x == null ? '' : x).replace(/[$,\s%]/g, '')); return isFinite(n) ? n : 0; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function countryConfig(code) {
    return DEFAULTS.countries[code] || DEFAULTS.countries[DEFAULTS.defaultCountry];
  }
  function currentCountry() {
    if (typeof document === 'undefined') return DEFAULTS.defaultCountry;
    var c = document.documentElement.getAttribute('data-country');
    return DEFAULTS.countries[c] ? c : DEFAULTS.defaultCountry;
  }

  // Adds thousands separators while typing, keeping the cursor in place.
  function formatMoneyInput(el) {
    var raw = el.value;
    var pos = el.selectionStart == null ? raw.length : el.selectionStart;
    var digitsBefore = raw.slice(0, pos).replace(/[^0-9]/g, '').length;
    var digits = raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    var out = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (out === raw) return;
    el.value = out;
    var i = 0, seen = 0;
    while (i < out.length && seen < digitsBefore) { if (/\d/.test(out[i])) seen++; i++; }
    if (document.activeElement === el) { try { el.setSelectionRange(i, i); } catch (e) {} }
  }

  // ---------------------------------------------------------------------------
  // 4. Page wiring
  // ---------------------------------------------------------------------------
  function readBenchmark(btn, country) {
    var id = btn.getAttribute('data-calc-benchmark');
    var base = countryConfig(country).benchmarks[id] || {};
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
      hist: attr('data-hist-return', base.hist, true),
      histPeriod: attr('data-hist-period', base.histPeriod || ''),
      fee: attr('data-fee', base.fee, true),
      note: attr('data-note', base.note || '')
    };
  }

  // A button belongs to a country if it (or a parent) has data-show="us"/"ca".
  // Buttons with no data-show are used for every country.
  function buttonCountry(btn) {
    var holder = btn.closest ? btn.closest('[data-show]') : null;
    return holder ? holder.getAttribute('data-show') : null;
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
    var allButtons = Array.prototype.slice.call(root.querySelectorAll('[data-calc-benchmark]'));
    var country = currentCountry();
    var selected = {}; // per country
    var modeButtons = Array.prototype.slice.call(root.querySelectorAll('[data-calc-mode]'));
    var mode = MODES[root.getAttribute('data-calc-default-mode')] ? root.getAttribute('data-calc-default-mode') : DEFAULTS.defaultMode;

    // Webflow puts inputs inside a Form block. Stop Enter from submitting it.
    var form = root.closest ? root.closest('form') : null;
    if (!form && inputs.balance && inputs.balance.form) form = inputs.balance.form;
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); });

    function buttonsFor(c) {
      return allButtons.filter(function (b) { var bc = buttonCountry(b); return !bc || bc === c; });
    }
    function selectedId() {
      if (!selected[country]) {
        var firstAttr = root.getAttribute('data-calc-default');
        var cfg = countryConfig(country);
        var btns = buttonsFor(country);
        var ids = btns.map(function (b) { return b.getAttribute('data-calc-benchmark'); });
        selected[country] = (firstAttr && ids.indexOf(firstAttr) > -1) ? firstAttr
          : (ids.indexOf(cfg.defaultBenchmark) > -1 || !ids.length) ? cfg.defaultBenchmark : ids[0];
      }
      return selected[country];
    }
    function currentBenchmark() {
      var id = selectedId();
      var btn = buttonsFor(country).filter(function (b) { return b.getAttribute('data-calc-benchmark') === id; })[0];
      if (btn) return readBenchmark(btn, country);
      var d = countryConfig(country).benchmarks[id] || countryConfig(country).benchmarks[countryConfig(country).defaultBenchmark];
      return { id: id, name: d.name, label: d.label, ret: d.ret, hist: d.hist, histPeriod: d.histPeriod, fee: d.fee, note: d.note };
    }

    function set(name, text) {
      var nodes = root.querySelectorAll('[data-calc-out="' + name + '"]');
      for (var i = 0; i < nodes.length; i++) nodes[i].textContent = text;
    }

    function update() {
      var bm = currentBenchmark();
      var useHist = mode === 'historical' && bm.hist;
      var ret = useHist ? bm.hist : bm.ret;
      var inflAttr = root.getAttribute('data-calc-inflation');
      var infl = inflAttr ? num(inflAttr) : MODES[mode].inflation;
      var r = calculate({
        balance: inputs.balance ? inputs.balance.value : 0,
        feePct: inputs.fee ? inputs.fee.value : 0,
        years: inputs.years ? inputs.years.value : 20,
        benchmark: { ret: ret, fee: bm.fee },
        inflation: infl
      });
      modeButtons.forEach(function (b) {
        var on = b.getAttribute('data-calc-mode') === mode;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      set('return-basis', useHist ? 'historical average, ' + bm.histPeriod : 'conservative estimate');
      set('inflation', pct(infl));
      var visible = buttonsFor(country);
      allButtons.forEach(function (b) {
        var on = visible.indexOf(b) > -1 && b.getAttribute('data-calc-benchmark') === bm.id;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      set('currency', countryConfig(country).currency);
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
      set('benchmark-return', pct(ret));
      set('benchmark-note', bm.note);
      root.setAttribute('data-calc-state', r.gap > 0 ? 'has-result' : 'empty');
      if (typeof global.CustomEvent === 'function') {
        root.dispatchEvent(new CustomEvent('feecalc:update', { detail: { result: r, benchmark: bm.id, country: country, mode: mode }, bubbles: true }));
      }
    }

    if (inputs.balance) {
      formatMoneyInput(inputs.balance);
      inputs.balance.addEventListener('input', function () { formatMoneyInput(inputs.balance); });
    }
    Object.keys(inputs).forEach(function (k) {
      if (inputs[k]) { inputs[k].addEventListener('input', update); inputs[k].addEventListener('change', update); }
    });
    allButtons.forEach(function (b) {
      if (b.tagName === 'BUTTON' && !b.getAttribute('type')) b.setAttribute('type', 'button');
      b.addEventListener('click', function (e) {
        e.preventDefault();
        selected[country] = b.getAttribute('data-calc-benchmark');
        update();
      });
    });
    modeButtons.forEach(function (b) {
      if (b.tagName === 'BUTTON' && !b.getAttribute('type')) b.setAttribute('type', 'button');
      b.addEventListener('click', function (e) { e.preventDefault(); mode = b.getAttribute('data-calc-mode'); update(); });
    });
    document.addEventListener('country:change', function () { country = currentCountry(); update(); });
    update();
  }

  function initAll() {
    var roots = document.querySelectorAll('[data-calc-root]');
    for (var i = 0; i < roots.length; i++) init(roots[i]);
  }

  var api = {
    calculate: calculate, init: init, initAll: initAll, defaults: DEFAULTS,
    format: { money: money, pct: pct }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PWSFeeCalc = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
    else initAll();
  }
})(typeof window !== 'undefined' ? window : globalThis);
