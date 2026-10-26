import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsFrom, normalizeTrack, recognitionRequest, historyCsv, historyStats, filterHistory, httpsUrl } from '../extension/core.js';

test('settings accept only the offered themes and durations', () => {
  assert.deepEqual(settingsFrom({ duration: 6, theme: 'dark' }), { duration: 6, theme: 'dark' });
  assert.deepEqual(settingsFrom({ duration: -1, theme: 'evil' }), { duration: 10, theme: 'nord' });
});

test('recognition responses handle no match, malformed metadata and unsafe URLs', () => {
  assert.equal(normalizeTrack({ matches: [] }), null);
  assert.throws(() => normalizeTrack({ track: { title: 2 } }), /invalid track/);
  const track = normalizeTrack({ track: { key: '42', title: '<script>', subtitle: 'Artist', url: 'javascript:alert(1)', images: { coverart: 'https://evil.test/cover.png' }, sections: [{ metadata: [{ title: 'Album', text: 'Album' }] }] } });
  assert.equal(track.title, '<script>');
  assert.equal(track.album, 'Album');
  assert.equal(track.url, '');
  assert.equal(track.cover, '');
  assert.equal(httpsUrl('https://www.shazam.com/song/42'), 'https://www.shazam.com/song/42');
  assert.equal(httpsUrl('http://example.com'), '');
});

test('requests match the fingerprint duration, including the service limit, without claiming a location', () => {
  const uri = 'data:audio/vnd.shazam.sig;base64,abcd';
  for (const duration of [6, 10, 15]) {
    const body = recognitionRequest(uri, duration, 1234567890123);
    assert.equal(body.signature.samplems, Math.min(duration, 12) * 1000);
    assert.equal(body.signature.timestamp, 1234567890123);
    assert.equal(body.geolocation, undefined);
  }
  assert.throws(() => recognitionRequest(uri, 999));
  assert.throws(() => recognitionRequest('bad', 10));
});

test('CSV escapes quotes, newlines, Unicode and spreadsheet formulas', () => {
  const csv = historyCsv([{ title: '=HYPERLINK("evil")', artist: 'Björk, Artist', album: 'a\nb', sourceTitle: '  +CMD', sourceUrl: 'https://example.com/?a=1,2' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(csv.includes('"Björk, Artist"'));
  assert.ok(csv.includes('"a\nb"'));
  assert.ok(csv.includes('"\'  +CMD"'));
  assert.ok(csv.endsWith('\r\n'));
});

test('overview counts unique tracks and filters without changing history', () => {
  const history = [{ key: '1', title: 'One', artist: 'Artist', album: 'Album' }, { key: '1', title: 'One', artist: 'Artist' }, { key: '2', title: 'Two', artist: 'Other' }];
  assert.deepEqual(historyStats(history), { recognitions: 3, tracks: 2, artists: 2 });
  assert.equal(filterHistory(history, ' ALBUM ').length, 1);
  assert.equal(filterHistory(history, 'artist').length, 2);
  assert.equal(history.length, 3);
});
