/**
 * Cloudflare Worker for worththefees.com
 *
 * Everything is served as static files, except /private, which needs an
 * access code. The code lives in a Worker secret called PRIVATE_ACCESS_CODE
 * (Cloudflare dashboard → this Worker → Settings → Variables and Secrets).
 * Change the secret and everyone who used the old code is locked out.
 *
 * The code is checked here, on Cloudflare's servers. The private page is
 * never sent to a browser that hasn't entered the right code.
 */

import calcModule from './fee-calculator.js';

const calc = calcModule && calcModule.calculate ? calcModule : globalThis.PWSFeeCalc;
const COOKIE = 'pws_private';
const MAX_AGE = 60 * 60 * 24 * 30; // remember for 30 days

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/api/report') return emailReport(request, env);
    if (path === '/api/sample-report') return emailSampleReport(request, env);
    const isPrivate = path === '/private' || path.startsWith('/private/');
    if (!isPrivate) return env.ASSETS.fetch(request);

    const code = (env.PRIVATE_ACCESS_CODE || '').trim();
    if (!code) return page(loginHtml('This page is not available yet.'), 503);

    const token = await sha256('pws-private:' + code);

    if (path === '/private/logout') {
      return redirect('/private', clearCookie());
    }

    if (path === '/private/login' && request.method === 'POST') {
      const form = await request.formData();
      const entered = String(form.get('code') || '').trim();
      const ok = await sha256('pws-private:' + entered) === token;
      if (ok) return redirect('/private/', setCookie(token));
      return page(loginHtml('That code didn’t match. Please try again, or contact your Ciccone McKay advisor.'), 401);
    }

    const signedIn = readCookie(request, COOKIE) === token;

    if (path === '/private/enquire' && request.method === 'POST') {
      if (!signedIn) return redirect('/private');
      const form = await request.formData();
      if (String(form.get('website') || '')) return redirect('/private/thanks.html'); // spam trap
      const name = clean(form.get('name'), 120);
      const contact = clean(form.get('contact'), 160);
      const message = String(form.get('message') || '').slice(0, 4000).trim();
      if (!name || !contact) return redirect('/private/?missing=1#begin');
      const sent = await sendEnquiry(env, { name, contact, message, when: new Date() });
      return redirect(sent ? '/private/thanks.html' : '/private/?error=1#begin');
    }

    if (signedIn) {
      // Serve the private files. /private → /private/
      if (path === '/private') return redirect('/private/');
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', 'private, no-store');
      out.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return out;
    }

    return page(loginHtml(''), 401);
  }
};

// ---------------------------------------------------------------------------
// "Email me my results" (POST /api/report, JSON)
//
// The visitor's inputs come in; the numbers are recomputed here with the same
// calculator code, so the email only ever contains our own figures.
// Sending uses Resend (resend.com). Needs runtime secret RESEND_API_KEY and a
// verified sending domain. Optional: REPORT_FROM (default
// "Worth the Fees <reports@worththefees.com>"), REPORT_REPLY_TO.
// If NOTIFY_EMAIL is set, Amos also gets a short lead notice.
// ---------------------------------------------------------------------------

const recent = new Map(); // best-effort limit per IP, per Worker instance
const LIMIT = 5, WINDOW_MS = 60 * 60 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function tooMany(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= LIMIT) return true;
  hits.push(now); recent.set(ip, hits);
  return false;
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(email);
}

// "Want it in your inbox? Email me a copy." (POST /api/sample-report, JSON)
// Sends the sample report PDF (attached, plus a link) through Resend.
export async function emailSampleReport(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
  let d;
  try { d = await request.json(); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!d || typeof d !== 'object') return json({ ok: false, error: 'Bad request.' }, 400);
  if (d.website) return json({ ok: true });
  const email = String(d.email || '').trim();
  if (!validEmail(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  if (tooMany(request)) return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);
  if (!env.RESEND_API_KEY) return json({ ok: false, error: 'Email is not switched on yet.' }, 503);

  const origin = new URL(request.url).origin;
  const pdfUrl = origin + '/sample-report.pdf';
  const html = '<div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1e1e1e">' +
    '<p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#5e5e5e;margin:0 0 8px">Worth the Fees · Powered by Prof of Wall Street</p>' +
    '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 16px">Your sample report</h1>' +
    '<p style="font-size:15px;line-height:1.6">Here is the sample Wealth Manager Performance &amp; Risk Assessment. It’s attached as a PDF, and you can also <a href="' + pdfUrl + '" style="color:#1f55a5">open it here</a>.</p>' +
    '<p style="font-size:15px;line-height:1.6">It follows a hypothetical family through the five pillars of a review: performance, cost, decisions, fit with their mandate, and integrity. Your own review uses your actual statements and trade history.</p>' +
    '<p style="margin:20px 0"><a href="https://calendly.com/profofwallstreet/15min" style="display:inline-block;background:#0c1a2a;color:#fff;text-decoration:none;padding:14px 22px;font-weight:600">Book a 15-minute call</a></p>' +
    '<p style="font-size:13px"><a href="' + origin + '/#calculator" style="color:#1f55a5">Try the free fee calculator</a></p>' +
    '<p style="font-size:11px;color:#8a8a8a;margin-top:28px">You asked us to email this from worththefees.com. We don’t share your email address. Illustrative example using hypothetical data.</p></div>';
  const text = 'Here is the sample Wealth Manager Performance & Risk Assessment (attached).\nOpen it online: ' + pdfUrl +
    '\n\nBook a 15-minute call: https://calendly.com/profofwallstreet/15min\nTry the free fee calculator: ' + origin + '/#calculator';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.REPORT_FROM || 'Worth the Fees <reports@worththefees.com>',
      to: [email],
      reply_to: env.REPORT_REPLY_TO || undefined,
      subject: 'Your sample report from Worth the Fees',
      html, text,
      attachments: [{ filename: 'Worth-the-Fees-Sample-Report.pdf', path: pdfUrl }]
    })
  });
  if (!res.ok) {
    console.log('Resend failed: ' + res.status + ' ' + (await res.text()).slice(0, 300));
    return json({ ok: false, error: 'We couldn’t send it just now. Please try again.' }, 502);
  }
  await sendEnquiry(env, { name: email, contact: email, message: 'Requested the sample report by email.', when: new Date() }, 'Sample report sent');
  return json({ ok: true });
}

export async function emailReport(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
  let d;
  try { d = await request.json(); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400); }
  if (!d || typeof d !== 'object') return json({ ok: false, error: 'Bad request.' }, 400);
  if (d.website) return json({ ok: true }); // spam trap: pretend it worked

  const email = String(d.email || '').trim();
  if (!validEmail(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  if (tooMany(request)) return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);

  const report = buildReport(d);
  if (!report) return json({ ok: false, error: 'Something was missing. Please check your numbers.' }, 400);
  if (!env.RESEND_API_KEY) return json({ ok: false, error: 'Email reports are not switched on yet.' }, 503);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.REPORT_FROM || 'Worth the Fees <reports@worththefees.com>',
      to: [email],
      reply_to: env.REPORT_REPLY_TO || undefined,
      subject: 'Your fee report from Worth the Fees',
      html: report.html,
      text: report.text
    })
  });
  if (!res.ok) {
    console.log('Resend failed: ' + res.status + ' ' + (await res.text()).slice(0, 300));
    return json({ ok: false, error: 'We couldn’t send it just now. Please try again.' }, 502);
  }

  // Lead notice to Amos (Cloudflare Email Routing). Failures are ignored.
  await sendEnquiry(env, {
    name: email,
    contact: email,
    message: report.summary + '\r\nInsights opt-in: ' + (d.optIn ? 'YES' : 'no'),
    when: new Date()
  }, 'Fee report sent');
  return json({ ok: true });
}

export function buildReport(d) {
  const countries = calc.defaults.countries;
  const country = countries[d.country] ? d.country : 'us';
  const cfg = countries[country];
  const bm = cfg.benchmarks[d.benchmark] || cfg.benchmarks[cfg.defaultBenchmark];
  const mode = calc.defaults.modes[d.mode] ? d.mode : calc.defaults.defaultMode;
  const ret = mode === 'historical' && bm.hist ? bm.hist : bm.ret;
  const infl = calc.defaults.modes[mode].inflation;
  const input = { balance: d.balance, feePct: d.fee, years: d.years, benchmark: { ret, fee: bm.fee, past: bm.past, pastNet: bm.pastNet }, inflation: infl };
  const r = calc.calculate(input);
  if (!(r.balance > 0)) return null;
  const p = calc.comparePast({ ...input, pastReturnPct: d.pastReturn, pastYears: d.pastYears, pastBasis: d.pastBasis === 'before' ? 'before' : 'after' });
  const m = calc.format.money, pc = calc.format.pct;
  const cur = cfg.currency;
  const sign = (x) => (x < 0 ? '−' : '') + pc(Math.abs(x));

  const rows = [
    ['Account value (' + cur + ')', m(r.balance)],
    ['All-in cost', pc(r.feeRate) + ' a year'],
    ['Years ahead', String(r.years)],
    ['Benchmark', bm.name + ' (' + bm.label + ' at ' + pc(bm.fee) + ')'],
    ['Fees this year', m(r.feeThisYear)],
    ['Value at your cost', m(r.valueAtFee)],
    ['Value in the low-cost benchmark', m(r.valueAtLowCost)]
  ];
  const pastRows = p ? [
    ['Period', p.years === 1 ? String(p.end) : p.start + '–' + p.end],
    [bm.name + ' benchmark, after its fee', pc(p.benchNet) + ' a year'],
    ['Your portfolio, after fees', pc(p.userNet) + ' a year'],
    ['Gap', sign(p.totalGap) + ' a year (fees ' + sign(p.feeGap) + ', investing ' + sign(p.investingGap) + ')']
  ] : [];
  const headline = 'Cost of your fees over ' + r.years + ' years: ' + m(r.gap) + ' (' + m(r.gapTodayDollars) + ' in today’s dollars)';
  const headline2 = p ? (p.cost >= 0 ? 'Cost of fees and investing gap: ' : 'Value added after fees: ') + m(Math.abs(p.cost)) + ' (' + m(Math.abs(p.costTodayDollars)) + ' in today’s dollars)' : '';
  const assumptions = 'Assumes ' + pc(ret) + ' a year before fees for ' + bm.label + ' (' + (mode === 'historical' ? 'historical average, ' + bm.histPeriod : 'conservative estimate') + '), no further deposits, and ' + pc(infl) + ' inflation for today’s dollars.' + (p ? ' Assumes your investing gap continues at the same rate.' : '') + ' Past returns do not guarantee future results. This is an estimate for education, not investment advice.';

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const table = (rs) => '<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">' + rs.map(([k, v]) => '<tr><td style="padding:10px 0;border-bottom:1px solid #e5e5e5;color:#333">' + esc(k) + '</td><td style="padding:10px 0;border-bottom:1px solid #e5e5e5;text-align:right;font-weight:600;color:#1e1e1e">' + esc(v) + '</td></tr>').join('') + '</table>';
  const html = '<div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1e1e1e">' +
    '<p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#5e5e5e;margin:0 0 8px">Worth the Fees · Powered by Prof of Wall Street</p>' +
    '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px;margin:0 0 20px">Your fee report</h1>' +
    table(rows) +
    '<p style="font-size:18px;font-weight:600;color:#b5473a;margin:20px 0 4px">' + esc(headline) + '</p>' +
    (p ? '<h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:28px 0 8px">Your past performance</h2>' + table(pastRows) +
      '<p style="font-size:18px;font-weight:600;color:' + (p.cost >= 0 ? '#b5473a' : '#2f6b57') + ';margin:20px 0 4px">' + esc(headline2) + '</p>' : '') +
    '<p style="font-size:12px;line-height:1.6;color:#5e5e5e;margin:24px 0">' + esc(assumptions) + '</p>' +
    '<p style="font-size:15px;line-height:1.6">This shows what the numbers cost. A full review shows why: how the investing decisions added or lost value, measured against your own Investment Policy Statement.</p>' +
    '<p style="margin:20px 0"><a href="https://calendly.com/profofwallstreet/15min" style="display:inline-block;background:#0c1a2a;color:#fff;text-decoration:none;padding:14px 22px;font-weight:600">Book a 15-minute call</a></p>' +
    '<p style="font-size:13px"><a href="https://worththefees.com/#calculator" style="color:#1f55a5">Run the calculator again</a></p>' +
    '<p style="font-size:11px;color:#8a8a8a;margin-top:28px">You asked us to email this report from worththefees.com. We don’t share your email address.</p></div>';
  const text = ['Your fee report, Worth the Fees', ''].concat(rows.map(([k, v]) => k + ': ' + v), ['', headline],
    p ? [''].concat(pastRows.map(([k, v]) => k + ': ' + v), [headline2]) : [],
    ['', assumptions, '', 'Book a 15-minute call: https://calendly.com/profofwallstreet/15min', 'Run the calculator again: https://worththefees.com/#calculator']).join('\n');
  const summary = rows.concat(pastRows).map(([k, v]) => k + ': ' + v).join('\r\n') + '\r\n' + headline + (p ? '\r\n' + headline2 : '');
  return { html, text, summary, result: r, past: p };
}

// Removes line breaks (blocks email header injection) and trims length.
function clean(v, max) {
  return String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

// Emails an enquiry to NOTIFY_EMAIL using Cloudflare Email Routing.
// Needs: the ENQUIRY_EMAIL send_email binding (wrangler.jsonc), Email Routing
// turned on for worththefees.com, NOTIFY_EMAIL verified as a destination
// address, and NOTIFY_EMAIL set as a runtime variable. Returns true if sent.
async function sendEnquiry(env, e, subjectPrefix) {
  const to = (env.NOTIFY_EMAIL || '').trim();
  if (!to) return false;
  const from = env.ENQUIRY_FROM || 'enquiries@worththefees.com';
  const looksLikeEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e.contact);
  const subject = (subjectPrefix || 'Private enquiry') + ': ' + e.name;
  const body = [
    subjectPrefix ? subjectPrefix + ' from worththefees.com' : 'New private enquiry from worththefees.com/private',
    '',
    'Name:    ' + e.name,
    'Contact: ' + e.contact,
    'Sent:    ' + e.when.toUTCString(),
    '',
    'Message:',
    e.message || '(none)',
    ''
  ].join('\r\n');

  // Preferred: Resend (same service as the visitor reports). Works for any
  // inbox, no Email Routing needed.
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Worth the Fees <' + from + '>', to: [to], subject,
          reply_to: looksLikeEmail ? e.contact : undefined, text: body
        })
      });
      if (res.ok) return true;
      console.log('Notice via Resend failed: ' + res.status);
    } catch (err) { console.log('Notice via Resend failed: ' + (err && err.message)); }
  }

  // Fallback: Cloudflare Email Routing (NOTIFY_EMAIL must be a verified destination).
  if (!env.ENQUIRY_EMAIL) return false;
  const EmailMessage = env.__EmailMessage || (await import('cloudflare:email')).EmailMessage;
  const raw = [
    'From: "Worth the Fees" <' + from + '>',
    'To: <' + to + '>',
    looksLikeEmail ? 'Reply-To: <' + e.contact + '>' : null,
    'Subject: ' + subject,
    'Date: ' + e.when.toUTCString(),
    'Message-ID: <' + crypto.randomUUID() + '@worththefees.com>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body
  ].filter((l) => l !== null).join('\r\n');
  try {
    await env.ENQUIRY_EMAIL.send(new EmailMessage(from, to, raw));
    return true;
  } catch (err) {
    console.log('Enquiry email failed: ' + (err && err.message));
    return false;
  }
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function setCookie(token) {
  return `${COOKIE}=${token}; Path=/private; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}
function clearCookie() {
  return `${COOKIE}=; Path=/private; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function redirect(location, cookie) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 303, headers });
}

function page(html, status) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loginHtml(message) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Private &amp; confidential</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#f7f4ee;color:#1b1b1b;font-family:'IBM Plex Sans',Arial,sans-serif;display:flex;flex-direction:column}
header{max-width:1120px;width:100%;margin:0 auto;padding:36px 40px 0;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px}
header .brand{font-family:Newsreader,Georgia,serif;font-size:22px}
header .tag{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b665c}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:64px 24px}
.box{width:100%;max-width:460px}
.eyebrow{margin:0;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#2f4a3a}
h1{margin:20px 0 0;font-family:Newsreader,Georgia,serif;font-weight:300;font-size:44px;line-height:1.08;letter-spacing:-.01em}
p.lede{margin:18px 0 0;font-size:16px;line-height:1.65;color:#3d3a33}
form{margin-top:40px;display:flex;flex-direction:column;gap:22px}
label{display:flex;flex-direction:column;gap:8px;font-size:13px;color:#6b665c}
input{font:inherit;font-size:22px;letter-spacing:.06em;padding:10px 0;border:0;border-bottom:1px solid #1b1b1b;background:transparent;color:#1b1b1b;outline:none}
input:focus{border-bottom:2px solid #2f4a3a}
button{align-self:flex-start;font:inherit;font-size:15px;letter-spacing:.04em;padding:16px 28px;min-height:48px;background:#1f2e25;color:#f7f4ee;border:0;cursor:pointer}
button:hover{background:#2f4a3a}
.msg{margin:0;font-size:14px;line-height:1.5;color:#8a3a2e}
.pws{display:inline-flex;align-items:center;gap:8px;color:#1b1b1b}.pws .pw-label{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#6b665c;margin-right:4px}.pws .pw-name{font-family:'IBM Plex Sans',Arial,sans-serif;font-size:11px;line-height:1.15;font-weight:500}
footer{max-width:1120px;width:100%;margin:0 auto;padding:24px 40px 36px;font-size:12px;color:#6b665c}
</style>
</head>
<body>
<header><span class="pws"><span class="pw-label">Powered by</span><svg aria-hidden="true" viewBox="0 0 26 26" width="22" height="22"><g stroke="currentColor" stroke-width="2"><line x1="4" x2="4" y1="10" y2="21"/><line x1="9.5" x2="9.5" y1="6" y2="21"/><line x1="15" x2="15" y1="12" y2="21"/><line x1="20.5" x2="20.5" y1="3" y2="21"/><line x1="1" x2="24" y1="24" y2="24"/></g></svg><span class="pw-name">Prof of<br>Wall Street</span></span><span class="tag">Private &amp; confidential</span></header>
<main>
  <div class="box">
    <p class="eyebrow">Prepared for the families of Ciccone McKay</p>
    <h1>Please enter your access code.</h1>
    <p class="lede">Your Ciccone McKay advisor can provide it.</p>
    <form method="post" action="/private/login">
      <label for="code">Access code
        <input id="code" name="code" type="password" autocomplete="current-password" autocapitalize="characters" spellcheck="false" required autofocus>
      </label>
      ${message ? `<p class="msg" role="alert">${escapeHtml(message)}</p>` : ''}
      <button type="submit">Continue</button>
    </form>
  </div>
</main>
<footer>Independent advisor reviews · Prof of Wall Street</footer>
</body>
</html>`;
}
