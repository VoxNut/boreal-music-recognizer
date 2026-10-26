import { historyCsv, httpsUrl } from './core.js';

export async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ target: 'background', type, ...data });
  if (response?.error) throw new Error(response.error);
  if (!response) throw new Error('Boreal did not respond. Reload the extension and try again.');
  return response;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function artwork(track) {
  const art = el('div', 'artwork');
  art.append(el('span', '', '♪'));
  if (track.cover) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = track.cover;
    image.addEventListener('error', () => image.remove(), { once: true });
    art.append(image);
  }
  return art;
}

export function trackLink(track, text = 'Open in Shazam ↗') {
  const url = httpsUrl(track.url);
  if (!url) return el('span', 'muted', 'No track link available');
  const link = el('a', 'track-link', text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

export function trackText(track) {
  const info = el('div', 'track-info');
  info.append(el('strong', 'track-title', track.title), el('span', 'track-artist', track.artist));
  return info;
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

export function exportHistory(history) {
  const url = URL.createObjectURL(new Blob([historyCsv(history)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `boreal-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function dateLabel(value) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
