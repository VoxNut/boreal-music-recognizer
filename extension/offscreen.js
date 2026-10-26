import init, { fingerprint } from './wasm/boreal.js';
import { normalizeTrack, recognitionRequest } from './core.js';

const wasmReady = init();
let running = false;
const report = message => chrome.runtime.sendMessage({ target: 'background', ...message });

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || message?.target !== 'offscreen') return;
  if (message.type !== 'CAPTURE' || running) return;
  running = true;
  reply({ ok: true });
  capture(message).catch(error => report({ type: 'COMPLETE', id: message.id, error: error.message || 'Recognition failed. Please try again.' }));
});

async function capture({ id, streamId, duration }) {
  let stream;
  let context;
  let timer;
  let worklet;
  let source;
  let samples;
  try {
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false })
        .then(value => { stream = value; return value; }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Audio capture timed out. Reload the tab and try again.')), 10000); }),
    ]);
    clearTimeout(timer);
    context = new AudioContext();
    await context.resume();
    source = context.createMediaStreamSource(stream);
    source.connect(context.destination);
    await context.audioWorklet.addModule('pcm-worklet.js');
    const frames = Math.round(context.sampleRate * duration);
    samples = new Float32Array(frames);
    worklet = new AudioWorkletNode(context, 'pcm-collector', { processorOptions: { frames } });
    let offset = 0;
    const recorded = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('No audio arrived. Make sure this tab is playing sound.')), (duration + 5) * 1000);
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => reject(new Error('The music tab stopped sharing audio. Try again.')), { once: true }));
      worklet.port.onmessage = ({ data }) => {
        samples.set(data.chunk, offset);
        offset += data.chunk.length;
        if (data.done) resolve();
      };
    });
    source.connect(worklet);
    worklet.connect(context.destination);
    // Do not await the worker: START may still hold its serialized mutation queue.
    report({ type: 'PROGRESS', id, status: 'listening', listeningAt: Date.now() });
    await recorded;
  } finally {
    clearTimeout(timer);
    worklet?.disconnect();
    source?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    if (context) await context.close();
  }
  report({ type: 'PROGRESS', id, status: 'recognizing' });
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  if (Math.sqrt(energy / samples.length) < 0.0001) {
    throw new Error('This tab was silent. Play the music, check the tab volume, and try again.');
  }
  const resampler = new OfflineAudioContext(1, duration * 16000, 16000);
  const buffer = resampler.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  const input = resampler.createBufferSource();
  input.buffer = buffer;
  input.connect(resampler.destination);
  input.start();
  const audio = await resampler.startRendering();
  const pcm = audio.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]));
  await wasmReady;
  const uri = fingerprint(pcm);
  const first = crypto.randomUUID().toUpperCase();
  const second = crypto.randomUUID();
  let response;
  try {
    response = await fetch(`https://amp.shazam.com/discovery/v5/en/US/android/-/tag/${first}/${second}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Language': 'en_US' },
      body: JSON.stringify(recognitionRequest(uri, duration)),
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? 'Recognition timed out. Please try again.' : 'Could not reach the recognition service. Check your connection and try again.');
  }
  if (response.status === 429) throw new Error('The free recognition service is rate limiting requests. Wait a few minutes before trying again.');
  if (!response.ok) throw new Error(`The recognition service is unavailable (${response.status}). Please try later.`);
  let data;
  try { data = await response.json(); } catch { throw new Error('The recognition service returned an unreadable response. Please try later.'); }
  const track = normalizeTrack(data);
  await report({ type: 'COMPLETE', id, track });
}
