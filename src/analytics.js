/*!
 * Site analytics for worththefees.com
 *
 * Events are counted anonymously in our own Cloudflare database (POST
 * /api/event): no cookies, no IPs, no personal data.
 * Google Analytics is optional: paste a GA4 Measurement ID below to also
 * send the same events to GA. While it is empty, GA never loads.
 *
 * Custom events:
 *   calculator_used        first time a visitor changes a calculator input
 *   past_return_entered    visitor types a past return (underperformance step)
 *   report_emailed         "Email me my results" sent successfully
 *   sample_report_download click on the sample report PDF
 *   sample_report_emailed  "Email me a copy" sent successfully
 *   book_call_click        click on any Calendly link
 */
(function () {
  'use strict';
  var GA_ID = ''; // e.g. 'G-XXXXXXXXXX'

  var sent = {};
  function track(name, params, once) {
    if (once) { if (sent[name]) return; sent[name] = true; }
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
    var detail = (params && params.country) || (location.pathname.indexOf('/private') === 0 ? 'private' : 'home');
    var body = JSON.stringify({ name: name, detail: detail });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/event/' + name, new Blob([body], { type: 'text/plain' }));
      else fetch('/api/event/' + name, { method: 'POST', body: body, keepalive: true });
    } catch (e) {}
  }
  window.pwsTrack = track;

  if (GA_ID) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn();
  }

  onReady(function () {
    // Calculator: count real interaction only (the page loads with example numbers).
    var calc = document.querySelector('[data-calc-root]');
    if (calc) {
      var used = function (e) {
        if (!e.isTrusted) return;
        if (e.target.closest && e.target.closest('[data-calc-email]')) return; // the email box isn't "using" the calculator
        var country = document.documentElement.getAttribute('data-country') || 'us';
        track('calculator_used', { country: country }, true);
      };
      calc.addEventListener('input', used);
      calc.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('[data-calc-benchmark],[data-calc-mode],[data-calc-period],[data-calc-basis]')) used(e);
      });
      var past = calc.querySelector('[data-calc="past-return"]');
      if (past) past.addEventListener('change', function () { if (past.value.trim()) track('past_return_entered', {}, true); });
    }

    // Links
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (/sample-report\.pdf$/.test(href)) track('sample_report_download', { link_text: (a.textContent || '').trim().slice(0, 60) || 'cover image' });
      else if (/calendly\.com/.test(href)) track('book_call_click', { page_location: location.pathname, link_text: (a.textContent || '').trim().slice(0, 60) });
    });
  });
})();
