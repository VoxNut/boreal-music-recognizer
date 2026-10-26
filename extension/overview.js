import { filterHistory, historyStats } from './core.js';
import { send, el, artwork, trackText, trackLink, applyTheme, exportHistory, dateLabel } from './ui.js';

const $ = id => document.getElementById(id);
let history = [];
let visible = [];
let noticeTimer;

function notice(text) {
  $('notice').textContent = text;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 4500);
}

function renderHistory() {
  visible = filterHistory(history, $('search').value);
  $('history-count').textContent = history.length;
  $('history').replaceChildren();
  $('export').disabled = !visible.length;
  $('clear').disabled = !history.length;
  $('showing').textContent = `${visible.length} of ${history.length} discoveries · latest 2,000 kept`;
  if (!visible.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('span', 'empty-icon', '♫'), el('h3', '', history.length ? 'No tracks found' : 'Your music trail starts here'), el('p', 'muted', history.length ? 'Try another title, artist, or album.' : 'Play music in a tab, then click the Boreal toolbar icon. Your discoveries will appear here.'));
    $('history').append(empty);
    return;
  }
  const heading = el('div', 'history-labels');
  heading.append(el('span', '', 'TRACK / ARTIST'), el('span', '', 'ALBUM'), el('span', '', 'DISCOVERED'), el('span', '', ''));
  $('history').append(heading);
  for (const track of visible) {
    const row = el('article', 'history-track');
    const identity = el('div', 'track-identity');
    identity.append(artwork(track), trackText(track));
    const album = el('span', 'album', track.album || '—');
    const when = el('div', 'track-date');
    const date = el('time', '', dateLabel(track.recognizedAt));
    date.dateTime = track.recognizedAt;
    const source = el('span', 'muted source-title', track.sourceTitle || 'Browser tab');
    source.title = track.sourceTitle;
    when.append(date, source);
    const actions = el('div', 'track-actions');
    const remove = el('button', 'icon-button', '×');
    remove.setAttribute('aria-label', `Remove ${track.title} from history`);
    remove.title = 'Remove from history';
    remove.addEventListener('click', () => send('DELETE', { id: track.id }).catch(error => notice(error.message)));
    actions.append(trackLink(track, '↗'), remove);
    actions.firstChild.setAttribute('aria-label', `Open ${track.title} in Shazam`);
    row.append(identity, album, when, actions);
    $('history').append(row);
  }
}

async function refresh() {
  const state = await send('GET_STATE');
  history = state.history;
  applyTheme(state.settings.theme);
  $('duration').value = state.settings.duration;
  $('theme').value = state.settings.theme;
  const stats = historyStats(history);
  for (const [key, value] of Object.entries(stats)) $(`stat-${key}`).textContent = value.toLocaleString();
  renderHistory();
}

$('search').addEventListener('input', renderHistory);
$('export').addEventListener('click', () => { exportHistory(visible); notice(`Exported ${visible.length} discoveries.`); });
$('clear').addEventListener('click', () => $('clear-dialog').showModal());
$('clear-dialog').addEventListener('close', () => {
  if ($('clear-dialog').returnValue === 'clear') send('CLEAR').catch(error => notice(error.message));
});
for (const id of ['duration', 'theme']) {
  $(id).addEventListener('change', () => send('SETTINGS', { settings: { [id]: id === 'duration' ? Number($(id).value) : $(id).value } }).catch(error => notice(error.message)));
}
chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') refresh().catch(error => notice(error.message)); });
refresh().catch(error => notice(error.message));
