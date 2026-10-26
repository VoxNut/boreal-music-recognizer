// Optional integration check: npm install --no-save playwright && npx playwright install chromium
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
await mkdir('test-results', { recursive: true });
let liveWav;
if (process.env.BOREAL_LIVE_PCM) {
  const bytes = await readFile(process.env.BOREAL_LIVE_PCM);
  assert.equal(bytes.length, 15 * 16000 * 4, 'Live capture fixture must be exactly 15 seconds.');
  const pcm = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  liveWav = Buffer.alloc(44 + pcm.length * 2);
  liveWav.write('RIFF'); liveWav.writeUInt32LE(liveWav.length - 8, 4); liveWav.write('WAVEfmt ', 8);
  liveWav.writeUInt32LE(16, 16); liveWav.writeUInt16LE(1, 20); liveWav.writeUInt16LE(1, 22);
  liveWav.writeUInt32LE(16000, 24); liveWav.writeUInt32LE(32000, 28); liveWav.writeUInt16LE(2, 32); liveWav.writeUInt16LE(16, 34);
  liveWav.write('data', 36); liveWav.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) liveWav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32768))), 44 + i * 2);
}
const server = createServer((request, response) => {
  if (request.url === '/music.wav' && liveWav) { response.setHeader('Content-Type', 'audio/wav'); response.end(liveWav); return; }
  if (request.url === '/music') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Live recognition sample</title><audio id="music" src="/music.wav" loop></audio><button onclick="document.querySelector(\'audio\').play()">Play music</button>');
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><title>Boreal test audio</title><button id="play">Play test tone</button><script>
    document.querySelector('button').onclick = async () => {
      const audio = new AudioContext(); await audio.resume();
      const oscillator = audio.createOscillator(); const gain = audio.createGain();
      gain.gain.value = 0.03; oscillator.connect(gain); gain.connect(audio.destination); oscillator.start();
      document.querySelector('button').textContent = 'Playing';
    };
  </script>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const extension = resolve('extension');
const context = await chromium.launchPersistentContext('', {
  channel: process.env.BOREAL_BROWSER_CHANNEL || 'chromium', headless: true, viewport: { width: 1440, height: 1100 },
  ignoreDefaultArgs: ['--mute-audio'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const base = `chrome-extension://${id}`;
  const dashboard = await context.newPage();
  await dashboard.goto(`${base}/overview.html`);
  await dashboard.locator('#theme').selectOption('dark');
  await dashboard.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await dashboard.locator('#theme').selectOption('nord');
  await dashboard.locator('#duration').selectOption('6');
  await dashboard.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.duration === 6);

  const wasm = await dashboard.evaluate(async () => {
    const module = await import('./wasm/boreal.js'); await module.default();
    return [6, 10, 15].map(seconds => module.fingerprint(new Float32Array(seconds * 16000).fill(0.1)).startsWith('data:audio/vnd.shazam.sig;base64,'));
  });
  assert.deepEqual(wasm, [true, true, true]);

  let requestBody;
  let mockRecognition = true;
  const browserSession = await context.browser().newBrowserCDPSession();
  let commandId = 0;
  const attached = new Set();
  const nested = (sessionId, method, params) => browserSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: ++commandId, method, params }) });
  browserSession.on('Target.targetInfoChanged', async ({ targetInfo }) => {
    if (!mockRecognition || !targetInfo.url.endsWith('/offscreen.html') || attached.has(targetInfo.targetId)) return;
    attached.add(targetInfo.targetId);
    const { sessionId } = await browserSession.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: false });
    await nested(sessionId, 'Fetch.enable', { patterns: [{ urlPattern: 'https://amp.shazam.com/*' }] });
  });
  browserSession.on('Target.receivedMessageFromTarget', async ({ sessionId, message }) => {
    const event = JSON.parse(message);
    if (event.method !== 'Fetch.requestPaused') return;
    requestBody = JSON.parse(event.params.request.postData);
    const body = JSON.stringify({ track: {
      key: 'test-track', title: 'Take On Me', subtitle: 'a-ha', url: 'https://www.shazam.com/song/217430269/take-on-me',
      sections: [{ metadata: [{ title: 'Album', text: 'Hunting High and Low' }] }],
    } });
    await nested(sessionId, 'Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(body).toString('base64') });
  });
  await browserSession.send('Target.setDiscoverTargets', { discover: true });
  const audioTab = await context.newPage();
  await audioTab.goto(`http://127.0.0.1:${server.address().port}`);
  await audioTab.locator('#play').click();
  await audioTab.bringToFront();
  const { targetInfos } = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const targetInfo = targetInfos.find(target => target.url === audioTab.url());
  assert.ok(targetInfo, 'Audio tab target exists');
  await browserSession.send('Extensions.triggerAction', { id, targetId: targetInfo.targetId });
  for (let attempt = 0; attempt < 125; attempt++) {
    const { job } = await dashboard.evaluate(() => chrome.storage.session.get('job'));
    if (['success', 'error', 'no-match'].includes(job?.status)) break;
    await dashboard.waitForTimeout(200);
  }
  const state = await dashboard.evaluate(async () => ({ ...await chrome.storage.session.get('job'), ...await chrome.storage.local.get(['history', 'settings']) }));
  assert.equal(state.job?.status, 'success', JSON.stringify(state.job));
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].title, 'Take On Me');
  assert.equal(state.history[0].duration, 6);
  assert.equal(requestBody.signature.samplems, 6000);
  assert.ok(requestBody.signature.uri.startsWith('data:audio/vnd.shazam.sig;base64,'));
  assert.equal(await worker.evaluate(() => chrome.offscreen.hasDocument()), false);
  await dashboard.locator('#stat-recognitions').filter({ hasText: '1' }).waitFor();
  await dashboard.locator('#search').fill('no such track');
  await dashboard.getByText('No tracks found', { exact: true }).waitFor();
  await dashboard.locator('#search').fill('');
  const downloadPromise = dashboard.waitForEvent('download');
  await dashboard.locator('#export').click();
  const download = await downloadPromise;
  await download.saveAs('test-results/history.csv');
  assert.match(await readFile('test-results/history.csv', 'utf8'), /Take On Me/);
  await dashboard.locator('#notice').waitFor({ state: 'hidden' });
  await dashboard.screenshot({ path: 'test-results/overview-nord.png', fullPage: true });
  await dashboard.locator('#theme').selectOption('dark');
  await dashboard.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await dashboard.screenshot({ path: 'test-results/overview-dark.png', fullPage: true });
  await dashboard.locator('#clear').click();
  await dashboard.getByRole('button', { name: 'Keep history' }).click();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('history'))).history.length, 1);
  await dashboard.locator('#clear').click();
  await dashboard.getByRole('button', { name: 'Clear history', exact: true }).last().click();
  await dashboard.getByText('Your music trail starts here', { exact: true }).waitFor();
  await dashboard.locator('#theme').selectOption('nord');
  await dashboard.screenshot({ path: 'test-results/overview-empty.png', fullPage: true });

  if (process.env.BOREAL_LIVE_PCM) {
    mockRecognition = false;
    await dashboard.locator('#duration').selectOption('15');
    await audioTab.goto(`http://127.0.0.1:${server.address().port}/music`);
    await audioTab.getByRole('button', { name: 'Play music' }).click();
    await audioTab.bringToFront();
    await dashboard.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'CANCEL' }));
    await browserSession.send('Extensions.triggerAction', { id, targetId: targetInfo.targetId });
    for (let attempt = 0; attempt < 225; attempt++) {
      const { job } = await dashboard.evaluate(() => chrome.storage.session.get('job'));
      if (['success', 'error', 'no-match'].includes(job?.status)) break;
      await dashboard.waitForTimeout(200);
    }
    const { job: live } = await dashboard.evaluate(() => chrome.storage.session.get('job'));
    await writeFile('test-results/live-recognition.json', JSON.stringify(live, null, 2));
    assert.equal(live.status, 'success', JSON.stringify(live));
    assert.ok(live.track, 'Live service should recognize the supplied known music sample.');
    assert.notEqual(live.track.key, 'test-track');
    assert.equal(live.track.duration, 15);
    console.log('Live recognition:', live.track.title, '—', live.track.artist);
  }
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: actual tab capture, WASM, history, search, CSV, themes and clear confirmation.');
} finally {
  await context.close();
  server.close();
}
