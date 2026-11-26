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

  // Past returns: calendar-year total returns, 2016 through PAST_END, in %.
  // pastNet: true = already after the ETF's own fee (ETF/fund NAV returns);
  // false = an index, so the low-cost fee is taken off each year.
  // Update once a year after the annual reports come out (see README).
  var PAST_END = 2025;

  var DEFAULTS = {
    inflation: 0.02,
    pastEnd: PAST_END,
    defaultMode: 'historical',
    modes: MODES,
    defaultCountry: 'us',
    countries: {
      us: {
        currency: 'US$',
        defaultBenchmark: 'sp',
        benchmarks: {
          sp:   { name: 'S&P 500',         label: 'an S&P 500 index ETF',     ret: 0.07,  hist: 0.100, histPeriod: '1928–2025', fee: 0.0003, note: 'For all-equity mandates focused on large U.S. companies.',
                  past: [12.17, 21.77, -4.50, 31.37, 18.32, 28.79, -18.17, 26.32, 24.98, 17.82], pastNet: true, pastSource: 'VOO (Vanguard S&P 500 ETF)' },
          qqq:  { name: 'NASDAQ-100',      label: 'a NASDAQ-100 ETF (QQQ)',   ret: 0.08,  hist: 0.1425, histPeriod: '1985–2024', fee: 0.0020, note: 'For growth mandates concentrated in U.S. technology. Higher expected return, with larger swings.',
                  past: [7.1, 32.7, -0.1, 39.0, 48.6, 27.4, -32.6, 54.9, 25.6, 20.8], pastNet: true, pastSource: 'QQQ (Invesco QQQ Trust)' },
          bal:  { name: '60/40 portfolio', label: 'a 60/40 balanced index fund', ret: 0.055, hist: 0.078, histPeriod: '1928–2025', fee: 0.0010, note: 'For balanced or more risk-averse mandates with a fixed income allocation.',
                  past: [8.77, 13.89, -2.86, 21.79, 16.40, 14.22, -16.90, 17.58, 14.59, 13.58], pastNet: true, pastSource: 'VBIAX (Vanguard Balanced Index, 60/40)' },
          cash: { name: 'Cash',            label: 'a money market fund',      ret: 0.03,  hist: 0.034, histPeriod: '1928–2025', fee: 0.0010, note: 'For capital-preservation mandates. Shows what fees cost against the safest option.',
                  past: [0.30, 0.81, 1.78, 2.14, 0.45, 0.01, 1.55, 5.09, 5.23, 4.22], pastNet: true, pastSource: 'VMFXX (Vanguard Federal Money Market)' }
        }
      },
      ca: {
        currency: 'C$',
        defaultBenchmark: 'tsx',
        benchmarks: {
          tsx:  { name: 'S&P/TSX Composite', label: 'a TSX index ETF',              ret: 0.065, hist: 0.105, histPeriod: '1976–2025', fee: 0.0006, note: 'For Canadian equity mandates.',
                  past: [21.0, 9.1, -8.8, 22.9, 5.6, 25.06, -5.85, 11.67, 21.53, 31.59], pastNet: true, pastSource: 'XIC (iShares Core S&P/TSX Capped Composite)' },
          sp:   { name: 'S&P 500',           label: 'an S&P 500 index ETF in CAD',  ret: 0.07,  hist: 0.100, histPeriod: '1928–2025, in US$', fee: 0.0009, note: 'For all-equity mandates focused on large U.S. companies, held in Canadian dollars.',
                  past: [8.46, 13.61, 3.35, 24.49, 15.58, 27.64, -12.69, 23.25, 35.24, 12.23], pastNet: true, pastSource: 'VFV (Vanguard S&P 500 Index ETF, CAD)' },
          bal:  { name: '60/40 portfolio',   label: 'a 60/40 balanced ETF',          ret: 0.055, hist: 0.089, histPeriod: '1976–2025', fee: 0.0024, note: 'For balanced or more risk-averse mandates with a fixed income allocation.',
                  past: [9.30, 5.50, -2.51, 15.19, 10.59, 11.06, -11.08, 12.78, 16.13, 13.33], pastNet: true, pastSource: 'XBAL (iShares Core Balanced ETF Portfolio)' },
          cash: { name: 'Cash',              label: 'a high-interest savings ETF',   ret: 0.03,  hist: 0.047, histPeriod: '1950–2025', fee: 0.0011, note: 'For capital-preservation mandates. Shows what fees cost against the safest option.',
                  past: [0.5, 0.6, 1.4, 1.6, 0.9, 0.2, 1.8, 4.7, 4.9, 2.8], pastNet: false, pastSource: 'FTSE Canada 91 Day T-Bill Index, less the ETF fee' }
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

  // Annualized return over the last n calendar years of a benchmark.
  function trailing(bm, n) {
    var rs = (bm.past || []).slice(-n);
    if (rs.length < n) return null;
    var p = 1;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i] / 100;
      if (!bm.pastNet) r = (1 + r) * (1 - num(bm.fee)) - 1;
      p *= 1 + r;
    }
    return Math.pow(p, 1 / n) - 1;
  }

  // Optional: compares the visitor's own past return with the benchmark over
  // the same period, splits the gap into fees and investing, and projects
  // the cost forward assuming that investing gap continues.
  //   input.pastReturnPct  e.g. "6.5" (annualized)
  //   input.pastYears      1, 3, 5 or 10
  //   input.pastBasis      'after' (after all fees, the default) or 'before'
  function comparePast(input) {
    var raw = input.pastReturnPct;
    if (raw == null || String(raw).trim() === '' || !isFinite(parseFloat(String(raw).replace(/[%\s]/g, '')))) return null;
    var fee = clamp(num(input.feePct) / 100, 0, 0.2);
    var lowFee = num(input.benchmark.fee);
    var n = [1, 3, 5, 10].indexOf(Math.round(num(input.pastYears))) > -1 ? Math.round(num(input.pastYears)) : 5;
    var benchNet = trailing(input.benchmark, n);
    if (benchNet == null) return null;
    var r = clamp(num(raw) / 100, -0.9, 1);
    var before = input.pastBasis === 'before';
    var userNet = before ? (1 + r) * (1 - fee) - 1 : r;
    var userGross = before ? r : (1 + r) / (1 - fee) - 1;
    var benchGross = (1 + benchNet) / (1 - lowFee) - 1;
    var totalGap = benchNet - userNet;          // + = you trailed
    var investingGap = benchGross - userGross;  // + = investing trailed, before fees
    var feeGap = totalGap - investingGap;

    // Forward: same as calculate(), with the investing gap carried forward.
    var balance = Math.max(0, num(input.balance));
    var years = Math.round(clamp(num(input.years), 1, 50));
    var ret = num(input.benchmark.ret);
    var inflation = input.inflation == null || input.inflation === '' ? DEFAULTS.inflation : num(input.inflation);
    var growth = Math.max(-0.99, ret - investingGap);
    var valueWithGap = balance * Math.pow((1 + growth) * (1 - fee), years);
    var valueAtLowCost = balance * Math.pow((1 + ret) * (1 - lowFee), years);
    var cost = valueAtLowCost - valueWithGap;   // can be negative if you beat it
    return {
      years: n, end: PAST_END, start: PAST_END - n + 1,
      benchNet: benchNet, benchGross: benchGross, userNet: userNet, userGross: userGross,
      totalGap: totalGap, investingGap: investingGap, feeGap: feeGap,
      beat: investingGap < 0,
      checkInput: Math.abs(investingGap) > 0.08,
      valueWithGap: valueWithGap, valueAtLowCost: valueAtLowCost,
      cost: cost, costTodayDollars: cost / Math.pow(1 + inflation, years)
    };
  }

  // Year-by-year values for the chart: low-cost benchmark, your cost, and
  // (optional) your cost with the investing gap continuing.
  function series(input) {
    var balance = Math.max(0, num(input.balance));
    var fee = clamp(num(input.feePct) / 100, 0, 0.2);
    var years = Math.round(clamp(num(input.years), 1, 50));
    var ret = num(input.benchmark.ret);
    var lowFee = num(input.benchmark.fee);
    var gap = input.investingGap == null ? null : num(input.investingGap);
    var out = { years: years, low: [], mine: [], withGap: gap == null ? null : [] };
    for (var i = 0; i <= years; i++) {
      out.low.push(balance * Math.pow((1 + ret) * (1 - lowFee), i));
      out.mine.push(balance * Math.pow((1 + ret) * (1 - fee), i));
      if (gap != null) out.withGap.push(balance * Math.pow((1 + Math.max(-0.99, ret - gap)) * (1 - fee), i));
    }
    return out;
  }

  function shortMoney(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  // Builds the chart as an SVG string (no libraries).
  function chartSvg(sr) {
    var W = 560, H = 250, L = 52, R = 12, T = 12, B = 30;
    var all = sr.low.concat(sr.mine, sr.withGap || []);
    var max = Math.max.apply(null, all) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(max / 4)));
    var nice = [1, 2, 2.5, 5, 10].map(function (m) { return m * step; }).filter(function (v) { return max / v <= 5; })[0] || step * 10;
    var top = Math.ceil(max / nice) * nice;
    var x = function (i) { return L + (W - L - R) * i / sr.years; };
    var y = function (v) { return T + (H - T - B) * (1 - Math.max(0, v) / top); };
    var line = function (arr) { return arr.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' '); };
    var g = '';
    for (var t = 0; t <= top + 1e-6; t += nice) {
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="#e7e7e3"/>' +
           '<text x="' + (L - 8) + '" y="' + (y(t) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#6b6b6b">' + shortMoney(t) + '</text>';
    }
    var ticks = [0, Math.round(sr.years / 2), sr.years];
    ticks.forEach(function (i) {
      g += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === sr.years ? 'end' : 'middle') + '" font-size="11" fill="#6b6b6b">' + (i === 0 ? 'Today' : 'Year ' + i) + '</text>';
    });
    var lower = sr.withGap || sr.mine;
    var area = line(sr.low) + ' ' + lower.slice().reverse().map(function (v, k) { var i = sr.years - k; return 'L' + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ') + ' Z';
    g += '<path d="' + area + '" fill="#b5473a" fill-opacity=".08"/>';
    g += '<path d="' + line(sr.low) + '" fill="none" stroke="#0c1a2a" stroke-width="2.5"/>';
    g += '<path d="' + line(sr.mine) + '" fill="none" stroke="#b5473a" stroke-width="2.5"/>';
    if (sr.withGap) g += '<path d="' + line(sr.withGap) + '" fill="none" stroke="#b5473a" stroke-width="2" stroke-dasharray="5 4"/>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Projected account value over ' + sr.years + ' years">' + g + '</svg>';
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
      note: attr('data-note', base.note || ''),
      past: base.past, pastNet: base.pastNet, pastSource: base.pastSource
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
      years: q('[data-calc="years"]'),
      pastReturn: q('[data-calc="past-return"]')
    };
    var pastYears = 5, pastBasis = 'after';
    var periodButtons = Array.prototype.slice.call(root.querySelectorAll('[data-calc-period]'));
    var basisButtons = Array.prototype.slice.call(root.querySelectorAll('[data-calc-basis]'));
    var pastBox = q('[data-calc-past]');
    var lastState = null;
    var pastNone = q('[data-calc-past-none]');
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
      return { id: id, name: d.name, label: d.label, ret: d.ret, hist: d.hist, histPeriod: d.histPeriod, fee: d.fee, note: d.note, past: d.past, pastNet: d.pastNet, pastSource: d.pastSource };
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
      // Optional past-performance comparison
      var p = comparePast({
        pastReturnPct: inputs.pastReturn ? inputs.pastReturn.value : '',
        pastYears: pastYears, pastBasis: pastBasis,
        feePct: inputs.fee ? inputs.fee.value : 0,
        balance: inputs.balance ? inputs.balance.value : 0,
        years: inputs.years ? inputs.years.value : 20,
        benchmark: { ret: ret, fee: bm.fee, past: bm.past, pastNet: bm.pastNet },
        inflation: infl
      });
      periodButtons.forEach(function (b) {
        var on = num(b.getAttribute('data-calc-period')) === pastYears;
        b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      basisButtons.forEach(function (b) {
        var on = b.getAttribute('data-calc-basis') === pastBasis;
        b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (pastBox) pastBox.hidden = !p;
      if (pastNone) pastNone.hidden = !!p;
      root.setAttribute('data-calc-past-state', p ? 'on' : 'off');
      if (p) {
        var sign = function (x) { return (x < 0 ? '−' : '') + pct(Math.abs(x)); };
        set('past-period', p.years === 1 ? 'the year ' + p.end : p.start + '–' + p.end);
        set('past-years', String(p.years));
        set('past-bench', pct(p.benchNet));
        set('past-user', pct(p.userNet));
        set('past-gap', sign(p.totalGap));
        set('past-fee-gap', sign(p.feeGap));
        set('past-invest-gap', sign(p.investingGap));
        set('past-source', bm.pastSource || bm.label);
        set('past-verdict', p.beat
          ? 'Before fees, your portfolio beat the benchmark by ' + pct(-p.investingGap) + ' a year. Fees took ' + pct(p.feeGap) + ' a year of that.'
          : 'Your portfolio trailed the benchmark by ' + pct(p.totalGap) + ' a year: ' + pct(Math.max(0, p.feeGap)) + ' from fees and ' + pct(p.investingGap) + ' from the investing itself.');
        set('past-cost-label', p.cost >= 0 ? 'Cost of fees and investing gap' : 'Value added after fees');
        set('past-cost', money(Math.abs(p.cost)));
        set('past-cost-today', money(Math.abs(p.costTodayDollars)));
        root.setAttribute('data-calc-past-beat', p.beat ? 'yes' : 'no');
        root.setAttribute('data-calc-past-check', p.checkInput ? 'yes' : 'no');
      }
      lastState = {
        country: country, benchmark: bm.id, mode: mode,
        balance: inputs.balance ? inputs.balance.value : '',
        fee: inputs.fee ? inputs.fee.value : '',
        years: inputs.years ? inputs.years.value : '',
        pastReturn: inputs.pastReturn ? inputs.pastReturn.value : '',
        pastYears: pastYears, pastBasis: pastBasis
      };
      var chart = q('[data-calc-chart]');
      if (chart) {
        chart.innerHTML = chartSvg(series({
          balance: inputs.balance ? inputs.balance.value : 0,
          feePct: inputs.fee ? inputs.fee.value : 0,
          years: inputs.years ? inputs.years.value : 20,
          benchmark: { ret: ret, fee: bm.fee },
          investingGap: p ? p.investingGap : null
        }));
      }
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
    periodButtons.forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); pastYears = num(b.getAttribute('data-calc-period')); update(); });
    });
    basisButtons.forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); pastBasis = b.getAttribute('data-calc-basis'); update(); });
    });
    var clearPast = q('[data-calc-past-clear]');
    if (clearPast) clearPast.addEventListener('click', function (e) {
      e.preventDefault();
      if (inputs.pastReturn) inputs.pastReturn.value = '';
      var d = clearPast.closest ? clearPast.closest('details') : null;
      if (d) d.open = false;
      update();
    });
    // "Email me my results"
    var emailForm = q('[data-calc-email]');
    if (emailForm) emailForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = emailForm.querySelector('[data-calc-email-status]');
      var btn = emailForm.querySelector('button[type="submit"]');
      var say = function (t, ok) { if (status) { status.textContent = t; status.setAttribute('data-ok', ok ? 'yes' : 'no'); } };
      var addr = emailForm.querySelector('[name="email"]');
      if (!addr || !addr.value.trim()) { say('Please enter your email address.', false); return; }
      var body = {};
      for (var k in lastState) body[k] = lastState[k];
      body.email = addr.value.trim();
      var opt = emailForm.querySelector('[name="optin"]'); body.optIn = !!(opt && opt.checked);
      var trap = emailForm.querySelector('[name="website"]'); body.website = trap ? trap.value : '';
      if (btn) btn.disabled = true;
      say('Sending…', true);
      fetch(emailForm.getAttribute('action') || '/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(function (res) { return res.json().catch(function () { return { ok: false }; }); })
        .then(function (r) {
          if (r && r.ok) { say('Sent. Check your inbox (and spam folder) in a minute or two.', true); if (global.pwsTrack) global.pwsTrack('report_emailed', { country: body.country, benchmark: body.benchmark }); }
          else say((r && r.error) || 'We couldn’t send it just now. Please try again.', false);
        })
        .catch(function () { say('We couldn’t send it just now. Please try again.', false); })
        .then(function () { if (btn) btn.disabled = false; });
    });
    document.addEventListener('country:change', function () { country = currentCountry(); update(); });
    update();
  }

  function initAll() {
    var roots = document.querySelectorAll('[data-calc-root]');
    for (var i = 0; i < roots.length; i++) init(roots[i]);
  }

  var api = {
    calculate: calculate, comparePast: comparePast, trailing: trailing, series: series, chartSvg: chartSvg, init: init, initAll: initAll, defaults: DEFAULTS,
    format: { money: money, pct: pct }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PWSFeeCalc = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
    else initAll();
  }
})(typeof window !== 'undefined' ? window : globalThis);
