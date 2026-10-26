import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let documentOpen = false;
let closes = 0;
const local = {};
const session = {};
function storage(data) {
  return { async get() { return structuredClone(data); }, async set(value) { Object.assign(data, structuredClone(value)); } };
}
globalThis.chrome = {
  runtime: {
    id: 'test', getURL: path => `chrome-extension://test/${path}`,
    onMessage: { addListener(fn) { listener = fn; } },
    async sendMessage(message) { assert.equal(message.target, 'offscreen'); return { ok: true }; },
  },
  storage: { local: storage(local), session: storage(session) },
  action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  tabs: { async query() { return [{ id: 1, url: 'https://example.com/music', title: 'Music' }]; } },
  tabCapture: { async getMediaStreamId() { return 'stream-id'; } },
  offscreen: {
    async hasDocument() { return documentOpen; },
    async closeDocument() { documentOpen = false; closes++; },
    async createDocument() { documentOpen = true; },
  },
};
await import('../extension/background.js');
function message(type, data = {}, page = 'popup.html') {
  return new Promise(resolve => listener({ target: 'background', type, ...data }, { id: 'test', url: `chrome-extension://test/${page}` }, resolve));
}

test('capture survives UI changes, prevents duplicates and ignores stale completion', async () => {
  await message('SETTINGS', { settings: { duration: 6, theme: 'dark' } });
  await message('START');
  const id = session.job.id;
  assert.equal(session.job.duration, 6);
  assert.equal(session.job.status, 'starting');
  await message('START');
  assert.equal(session.job.id, id);
  await message('PROGRESS', { id, status: 'listening', listeningAt: 123 }, 'offscreen.html');
  assert.equal(session.job.status, 'listening');
  await message('CANCEL');
  assert.equal(documentOpen, false);
  await message('COMPLETE', { id, track: { title: 'Stale', artist: 'Artist' } }, 'offscreen.html');
  assert.equal(local.history, undefined);
  await message('START');
  const newId = session.job.id;
  await message('COMPLETE', { id: newId, track: { key: '1', title: 'Song', artist: 'Artist' } }, 'offscreen.html');
  assert.equal(session.job.status, 'success');
  assert.equal(local.history.length, 1);
  assert.equal(local.history[0].sourceUrl, 'https://example.com/music');
  assert.equal(documentOpen, false);
  await message('DELETE', { id: newId });
  assert.equal(local.history.length, 0);
  assert.ok(closes >= 2);
});

test('expired jobs recover and history is bounded', async () => {
  local.history = Array.from({ length: 2000 }, (_, i) => ({ id: String(i) }));
  await message('START');
  await message('COMPLETE', { id: session.job.id, track: { title: 'New', artist: 'Artist' } }, 'offscreen.html');
  assert.equal(local.history.length, 2000);
  assert.equal(local.history[0].title, 'New');
  session.job = { status: 'listening', id: 'expired', startedAt: Date.now() - 100000 };
  await message('GET_STATE');
  assert.equal(session.job.status, 'error');
  assert.match(session.job.error, /timed out/);
  await message('CLEAR');
  assert.equal(local.history.length, 0);
});

test('web tabs and other extensions cannot trigger privileged handlers', () => {
  assert.equal(listener({ target: 'background', type: 'CLEAR' }, { id: 'other', url: 'https://evil.test' }, () => {}), undefined);
  assert.equal(listener({ target: 'background', type: 'START' }, { id: 'test', url: 'https://evil.test', tab: { id: 7 } }, () => {}), undefined);
});
