// Run with: node --test test/worker.test.mjs   (Node 18+)
// Simulates Cloudflare: a fake ASSETS binding and the access-code secret.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.mjs';

const ASSETS = { fetch: async (req) => new Response('ASSET ' + new URL(req.url).pathname, { status: 200, headers: { 'Content-Type': 'text/html' } }) };
const env = { ASSETS, PRIVATE_ACCESS_CODE: 'CM-2026' };
const get = (path, cookie) => worker.fetch(new Request('https://worththefees.com' + path, { headers: cookie ? { Cookie: cookie } : {} }), env);
const login = (code) => {
  const body = new URLSearchParams({ code });
  return worker.fetch(new Request('https://worththefees.com/private/login', { method: 'POST', body }), env);
};

test('public pages are served normally', async () => {
  const r = await get('/');
  assert.equal(await r.text(), 'ASSET /');
});

test('private page asks for the code and never leaks content', async () => {
  for (const p of ['/private', '/private/', '/private/index.html']) {
    const r = await get(p);
    assert.equal(r.status, 401);
    const t = await r.text();
    assert.match(t, /enter your access code/i);
    assert.doesNotMatch(t, /ASSET/);
  }
});

test('wrong code is refused', async () => {
  const r = await login('nope');
  assert.equal(r.status, 401);
  assert.match(await r.text(), /didn.t match/);
});

test('right code sets a cookie and unlocks the page', async () => {
  const r = await login('  CM-2026 ');
  assert.equal(r.status, 303);
  const cookie = r.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\/private/);
  const pair = cookie.split(';')[0];
  const page = await get('/private/', pair);
  assert.equal(await page.text(), 'ASSET /private/');
  assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
});

test('changing the code locks out old cookies', async () => {
  const r = await login('CM-2026');
  const pair = r.headers.get('Set-Cookie').split(';')[0];
  const env2 = { ASSETS, PRIVATE_ACCESS_CODE: 'NEW-CODE' };
  const page = await worker.fetch(new Request('https://worththefees.com/private/', { headers: { Cookie: pair } }), env2);
  assert.equal(page.status, 401);
});

test('no secret set means no access', async () => {
  const r = await worker.fetch(new Request('https://worththefees.com/private/'), { ASSETS });
  assert.equal(r.status, 503);
});

test('sign out clears the cookie', async () => {
  const r = await get('/private/logout');
  assert.equal(r.status, 303);
  assert.match(r.headers.get('Set-Cookie'), /Max-Age=0/);
});

// ---- enquiry form ----
class FakeEmailMessage { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }
const signedInCookie = async () => (await login('CM-2026')).headers.get('Set-Cookie').split(';')[0];
const enquire = (fields, cookie, extraEnv = {}) => {
  const sent = [];
  const e = { ...env, NOTIFY_EMAIL: 'owner@example.com', ENQUIRY_EMAIL: { send: async (m) => sent.push(m) }, __EmailMessage: FakeEmailMessage, ...extraEnv };
  const req = new Request('https://worththefees.com/private/enquire', { method: 'POST', body: new URLSearchParams(fields), headers: cookie ? { Cookie: cookie } : {} });
  return worker.fetch(req, e).then((r) => ({ r, sent }));
};

test('enquiry is emailed and the visitor sees a thank-you page', async () => {
  const { r, sent } = await enquire({ name: 'Jane Doe', contact: 'jane@example.com', message: 'Hello' }, await signedInCookie());
  assert.equal(r.headers.get('Location'), '/private/thanks.html');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');
  assert.match(sent[0].raw, /Subject: Private enquiry: Jane Doe/);
  assert.match(sent[0].raw, /Reply-To: <jane@example.com>/);
  assert.match(sent[0].raw, /Hello/);
});

test('enquiry needs the access code', async () => {
  const { r, sent } = await enquire({ name: 'X', contact: 'x@example.com' });
  assert.equal(r.headers.get('Location'), '/private');
  assert.equal(sent.length, 0);
});

test('header injection is blocked', async () => {
  const { sent } = await enquire({ name: 'Eve\r\nBcc: spam@example.com', contact: 'e@example.com' }, await signedInCookie());
  assert.doesNotMatch(sent[0].raw, /\r\nBcc:/);
});

test('spam trap and missing fields send nothing', async () => {
  const c = await signedInCookie();
  assert.equal((await enquire({ name: 'Bot', contact: 'b@example.com', website: 'x' }, c)).sent.length, 0);
  const { r, sent } = await enquire({ name: '', contact: '' }, c);
  assert.match(r.headers.get('Location'), /missing=1/);
  assert.equal(sent.length, 0);
});

test('if email is not set up, the visitor is offered Calendly', async () => {
  const { r } = await enquire({ name: 'A', contact: 'a@example.com' }, await signedInCookie(), { NOTIFY_EMAIL: '' });
  assert.match(r.headers.get('Location'), /error=1/);
});

// ---- Email me my results ----
const post = (body, e = {}) => worker.fetch(new Request('https://worththefees.com/api/report', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': String(Math.random()) }, body: JSON.stringify(body)
}), { ASSETS, ...e });
const good = { email: 'jane@example.com', country: 'us', benchmark: 'sp', mode: 'historical', balance: '1,000,000', fee: '2', years: '20', pastReturn: '7', pastYears: 5, pastBasis: 'after' };

test('report is recomputed on the server and sent through Resend', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); };
  try {
    const r = await post(good, { RESEND_API_KEY: 'test' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.deepEqual(calls[0].body.to, ['jane@example.com']);
    assert.match(calls[0].body.html, /\$2,195,917/);          // same as the page
    assert.match(calls[0].body.text, /Your portfolio, after fees: 7% a year/);
  } finally { globalThis.fetch = realFetch; }
});

test('bad email, spam trap and missing key are handled', async () => {
  assert.equal((await post({ ...good, email: 'nope' }, { RESEND_API_KEY: 'x' })).status, 400);
  assert.equal((await (await post({ ...good, website: 'bot' }, { RESEND_API_KEY: 'x' })).json()).ok, true);
  assert.equal((await post(good)).status, 503);
});

test('only POST is accepted', async () => {
  const r = await worker.fetch(new Request('https://worththefees.com/api/report'), { ASSETS });
  assert.equal(r.status, 405);
});

test('lead notice goes to NOTIFY_EMAIL through Resend', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  try {
    await post({ ...good, optIn: true }, { RESEND_API_KEY: 'test', NOTIFY_EMAIL: 'owner@example.com' });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].to, ['owner@example.com']);
    assert.match(calls[1].subject, /^Fee report sent: jane@example.com/);
    assert.equal(calls[1].reply_to, 'jane@example.com');
    assert.match(calls[1].text, /Insights opt-in: YES/);
  } finally { globalThis.fetch = realFetch; }
});

test('sample report is emailed with the PDF attached, and Amos is notified', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  try {
    const r = await worker.fetch(new Request('https://worththefees.com/api/sample-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'x' + Math.random() },
      body: JSON.stringify({ email: 'sam@example.com' })
    }), { ASSETS, RESEND_API_KEY: 'test', NOTIFY_EMAIL: 'owner@example.com' });
    assert.equal((await r.json()).ok, true);
    assert.deepEqual(calls[0].to, ['sam@example.com']);
    assert.equal(calls[0].attachments[0].path, 'https://worththefees.com/sample-report.pdf');
    assert.match(calls[1].subject, /^Sample report sent: sam@example.com/);
  } finally { globalThis.fetch = realFetch; }
});
