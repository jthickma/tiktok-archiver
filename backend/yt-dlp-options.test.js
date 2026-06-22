import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_VIDEO_FORMAT,
  buildBrowserVideoArgs,
} from './yt-dlp-options.js';

test('yt-dlp video selection only falls back to browser-compatible H.264', () => {
  const args = buildBrowserVideoArgs('/downloads/video.%(ext)s');

  assert.equal(args[args.indexOf('--format') + 1], BROWSER_VIDEO_FORMAT);
  assert.match(BROWSER_VIDEO_FORMAT, /vcodec\^=h264/);
  assert.doesNotMatch(BROWSER_VIDEO_FORMAT, /(?:^|\/)best(?:video)?(?:\+|\/|$)/);
  assert.deepEqual(args.slice(args.indexOf('--merge-output-format'), args.indexOf('--merge-output-format') + 2), [
    '--merge-output-format',
    'mp4',
  ]);
});
