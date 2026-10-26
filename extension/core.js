export const DEFAULT_SETTINGS = Object.freeze({ duration: 10, theme: 'nord' });
export const HISTORY_LIMIT = 2000;
export const BUSY = ['starting', 'listening', 'recognizing'];

export function settingsFrom(value = {}) {
  return {
    duration: [6, 10, 15].includes(value.duration) ? value.duration : 10,
    theme: value.theme === 'dark' ? 'dark' : 'nord',
  };
}

export function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeTrack(data) {
  const track = data?.track;
  if (!track) return null;
  if (typeof track.title !== 'string' || !track.title.trim() || typeof track.subtitle !== 'string') {
    throw new Error('The recognition service returned an invalid track. Please try again.');
  }
  const metadata = Array.isArray(track.sections)
    ? track.sections.flatMap(section => Array.isArray(section.metadata) ? section.metadata : []) : [];
  const album = metadata.find(item => item.title === 'Album')?.text;
  const image = httpsUrl(track.images?.coverart);
  let cover = '';
  if (image) {
    const host = new URL(image).hostname;
    if (/(^|\.)(mzstatic|shazam)\.com$/.test(host)) cover = image;
  }
  const key = typeof track.key === 'string' ? track.key.slice(0, 100) : '';
  return {
    key,
    title: track.title.slice(0, 500),
    artist: track.subtitle.slice(0, 500),
    album: typeof album === 'string' ? album.slice(0, 500) : '',
    genre: typeof track.genres?.primary === 'string' ? track.genres.primary.slice(0, 100) : '',
    cover,
    url: httpsUrl(track.url),
  };
}

export function recognitionRequest(uri, duration, now = Date.now()) {
  if (!uri?.startsWith('data:audio/vnd.shazam.sig;base64,') || ![6, 10, 15].includes(duration)) {
    throw new Error('Invalid audio fingerprint.');
  }
  return {
    signature: { samplems: Math.min(duration, 12) * 1000, timestamp: now, uri },
    timestamp: now,
    timezone: 'UTC',
  };
}

export function historyStats(history) {
  return {
    recognitions: history.length,
    tracks: new Set(history.map(item => item.key || `${item.title}\n${item.artist}`)).size,
    artists: new Set(history.map(item => item.artist)).size,
  };
}

export function filterHistory(history, query) {
  const text = query.trim().toLocaleLowerCase();
  return history.filter(item => `${item.title} ${item.artist} ${item.album} ${item.sourceTitle}`.toLocaleLowerCase().includes(text));
}

function csvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet applications can execute formulas even inside quoted CSV cells.
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function historyCsv(history) {
  const columns = ['Recognized at (UTC)', 'Title', 'Artist', 'Album', 'Genre', 'Listening seconds', 'Shazam URL', 'Source title', 'Source URL'];
  const rows = history.map(item => [item.recognizedAt, item.title, item.artist, item.album, item.genre, item.duration, item.url, item.sourceTitle, item.sourceUrl]);
  return '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
