import { BUSY, HISTORY_LIMIT, settingsFrom } from './core.js';

// Serialize storage mutations so completion, cancellation and history edits cannot overwrite each other.
let mutations = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const page = sender.url?.split(/[?#]/)[0];
  if (!['popup.html', 'overview.html', 'offscreen.html'].some(path => page === chrome.runtime.getURL(path))) return;
  if (message?.target !== 'background') return;
  const fromOffscreen = page === chrome.runtime.getURL('offscreen.html');
  const allowed = fromOffscreen ? ['PROGRESS', 'COMPLETE'] : ['GET_STATE', 'START', 'CANCEL', 'SETTINGS', 'DELETE', 'CLEAR'];
  if (!allowed.includes(message.type)) return;
  const task = mutations.then(() => handle(message));
  mutations = task.catch(() => {});
  task.then(reply, error => reply({ error: error.message || 'Something went wrong. Please try again.' }));
  return true;
});

async function jobState(job) {
  await chrome.storage.session.set({ job });
  const badge = job.status === 'listening' ? '♪' : job.status === 'recognizing' ? '…' : '';
  await chrome.action.setBadgeBackgroundColor({ color: '#5e81ac' });
  await chrome.action.setBadgeText({ text: badge });
}

async function closeCapture() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
}

async function handle(message) {
  let { job = { status: 'idle' } } = await chrome.storage.session.get('job');
  if (BUSY.includes(job.status) && Date.now() - job.startedAt > 90000) {
    await closeCapture();
    job = { status: 'error', error: 'Listening timed out. Open the music tab and try again.' };
    await jobState(job);
  }
  switch (message.type) {
    case 'GET_STATE': {
      const { settings, history = [] } = await chrome.storage.local.get(['settings', 'history']);
      return { job, settings: settingsFrom(settings), history };
    }
    case 'START': {
      if (BUSY.includes(job.status)) return { job };
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) {
        await jobState({ status: 'error', error: 'Open a website playing music, then click Boreal in that tab. Browser pages and local files cannot be captured.' });
        return {};
      }
      const { settings } = await chrome.storage.local.get('settings');
      const duration = settingsFrom(settings).duration;
      const id = crypto.randomUUID();
      job = { id, status: 'starting', startedAt: Date.now(), duration, sourceTitle: tab.title || '', sourceUrl: tab.url };
      await jobState(job);
      try {
        await closeCapture();
        await chrome.offscreen.createDocument({
          url: 'offscreen.html', reasons: ['USER_MEDIA'],
          justification: 'Capture the active tab for a user-selected music fingerprint, then stop all tracks.',
        });
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CAPTURE', id, streamId, duration });
        if (!response?.ok) throw new Error(response?.error || 'The audio recorder could not start.');
      } catch (error) {
        await closeCapture();
        await jobState({ status: 'error', error: `Could not capture this tab. ${error.message}` });
      }
      return {};
    }
    case 'CANCEL':
      await closeCapture();
      await jobState({ status: 'idle' });
      return {};
    case 'PROGRESS':
      if (message.id !== job.id || !['listening', 'recognizing'].includes(message.status)) return {};
      await jobState({ ...job, status: message.status, listeningAt: message.listeningAt || job.listeningAt });
      return {};
    case 'COMPLETE': {
      if (message.id !== job.id || !BUSY.includes(job.status)) return {};
      if (message.error) {
        await jobState({ status: 'error', error: String(message.error).slice(0, 1000) });
      } else if (!message.track) {
        await jobState({ status: 'no-match', duration: job.duration });
      } else {
        const record = { ...message.track, id: job.id, duration: job.duration, recognizedAt: new Date().toISOString(), sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl };
        const { history = [] } = await chrome.storage.local.get('history');
        await chrome.storage.local.set({ history: [record, ...history].slice(0, HISTORY_LIMIT) });
        await jobState({ status: 'success', track: record });
      }
      await closeCapture();
      return {};
    }
    case 'SETTINGS': {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: settingsFrom({ ...settings, ...message.settings }) });
      return {};
    }
    case 'DELETE': {
      const { history = [] } = await chrome.storage.local.get('history');
      await chrome.storage.local.set({ history: history.filter(item => item.id !== message.id) });
      return {};
    }
    case 'CLEAR':
      await chrome.storage.local.set({ history: [] });
      return {};
  }
}
