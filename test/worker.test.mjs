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
