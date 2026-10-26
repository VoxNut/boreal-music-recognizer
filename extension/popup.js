import { BUSY } from './core.js';
import { send, el, artwork, trackLink, trackText, applyTheme } from './ui.js';

const $ = id => document.getElementById(id);
let current;
let settings;

function renderJob(job) {
  current = job;
  const busy = BUSY.includes(job.status);
  $('orb').classList.toggle('listening', busy);
  $('orb').classList.toggle('found', job.status === 'success');
  $('duration').disabled = busy;
  $('listen').textContent = busy ? 'Cancel listening' : job.status === 'idle' ? 'Recognize music' : 'Listen again';
  $('listen').classList.toggle('secondary', busy);
  const labels = {
    idle: ['Ready to discover', 'Play something. Find your next favorite.'],
    starting: ['Getting ready', 'Connecting to the sound in this tab…'],
    listening: ['Listening closely', `Catching ${job.duration} seconds of the good part.`],
    recognizing: ['Finding your track', 'Matching its fingerprint. Just a moment…'],
    success: ['Found your sound', 'One more for your music trail.'],
    'no-match': ['No match this time', 'Try a clearer section, or listen for 15 seconds.'],
    error: ['Couldn’t catch that', job.error],
  };
  const [title, detail] = labels[job.status] || labels.idle;
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('progress').hidden = job.status !== 'listening';
  $('result').replaceChildren();
  $('result').hidden = !job.track;
  if (job.track) {
    const info = trackText(job.track);
    info.append(trackLink(job.track));
    $('result').append(artwork(job.track), info);
  }
  updateProgress();
}

function updateProgress() {
  if (current?.status === 'listening') $('progress').value = Math.min(100, (Date.now() - current.listeningAt) / (current.duration * 10));
}
setInterval(updateProgress, 200);

function renderSettings(value) {
  settings = value;
  applyTheme(settings.theme);
  $('duration').value = settings.duration;
  $('theme').textContent = settings.theme === 'nord' ? 'Dark theme' : 'Nord theme';
  $('theme').setAttribute('aria-label', `Switch to ${settings.theme === 'nord' ? 'dark' : 'Nord'} theme`);
}

function renderRecent(history) {
  $('recent').replaceChildren();
  if (!history.length) {
    $('recent').append(el('p', 'empty-small', 'Your next discovery starts here.'));
    return;
  }
  for (const track of history.slice(0, 3)) {
    const row = el('div', 'recent-track');
    row.append(artwork(track), trackText(track), trackLink(track, '↗'));
    row.lastChild.setAttribute('aria-label', `Open ${track.title} in Shazam`);
    $('recent').append(row);
  }
}

async function refresh() {
  const state = await send('GET_STATE');
  renderSettings(state.settings);
  renderJob(state.job);
  renderRecent(state.history);
}

function showError(error) { renderJob({ status: 'error', error: error.message }); }

$('listen').addEventListener('click', async () => {
  $('listen').disabled = true;
  try { await send(BUSY.includes(current?.status) ? 'CANCEL' : 'START'); await refresh(); }
  catch (error) { showError(error); }
  finally { $('listen').disabled = false; }
});
$('duration').addEventListener('change', () => send('SETTINGS', { settings: { duration: Number($('duration').value) } }).catch(showError));
$('theme').addEventListener('click', () => send('SETTINGS', { settings: { theme: settings.theme === 'nord' ? 'dark' : 'nord' } }).catch(showError));
chrome.storage.onChanged.addListener(() => refresh().catch(showError));

try {
  await refresh();
  if (!BUSY.includes(current.status)) {
    await send('START');
    await refresh();
  }
} catch (error) { showError(error); }
