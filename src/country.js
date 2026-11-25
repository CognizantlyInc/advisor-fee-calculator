/*!
 * Country chooser · Prof of Wall Street
 * Asks visitors once whether they invest in the United States or Canada,
 * remembers the answer in their own browser, and switches the page.
 *
 * - <html data-country="us"> holds the current country (US is the default).
 * - Anything with data-show="us" or data-show="ca" only shows for that country.
 * - A <dialog id="country-dialog"> with buttons [data-set-country="us|ca"]
 *   is the first-visit pop-up. Closing it without choosing keeps US.
 * - Any element with [data-open-country] reopens the pop-up.
 * - Fires a "country:change" event on document when the country changes.
 */
(function () {
  'use strict';
  var KEY = 'pws-country';
  var VALID = { us: 1, ca: 1 };
  var root = document.documentElement;

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(c) { try { localStorage.setItem(KEY, c); } catch (e) {} }

  function apply(c) {
    if (!VALID[c]) c = 'us';
    root.setAttribute('data-country', c);
    var labels = document.querySelectorAll('[data-country-label]');
    for (var i = 0; i < labels.length; i++) labels[i].textContent = c === 'ca' ? 'Canada' : 'United States';
    var opts = document.querySelectorAll('[data-set-country]');
    for (var j = 0; j < opts.length; j++) {
      opts[j].setAttribute('aria-pressed', opts[j].getAttribute('data-set-country') === c ? 'true' : 'false');
    }
    document.dispatchEvent(new CustomEvent('country:change', { detail: { country: c } }));
  }

  // Apply a saved choice as early as possible.
  var saved = read();
  if (VALID[saved]) root.setAttribute('data-country', saved);

  function ready() {
    var dialog = document.getElementById('country-dialog');
    apply(root.getAttribute('data-country'));

    function open() {
      if (!dialog) return;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    function close() {
      if (!dialog) return;
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
    }

    document.addEventListener('click', function (e) {
      var set = e.target.closest && e.target.closest('[data-set-country]');
      if (set) {
        e.preventDefault();
        var c = set.getAttribute('data-set-country');
        save(c); apply(c); close();
        return;
      }
      if (e.target.closest && e.target.closest('[data-open-country]')) { e.preventDefault(); open(); }
    });

    if (dialog) {
      // Closing with Esc or the close button keeps the current country (US by default) and remembers it.
      dialog.addEventListener('close', function () { if (!VALID[read()]) save(root.getAttribute('data-country')); });
      // Click on the dim backdrop closes it too.
      dialog.addEventListener('click', function (e) { if (e.target === dialog) close(); });
    }

    if (!VALID[saved]) open();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
