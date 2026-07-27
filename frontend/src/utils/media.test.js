import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionGroupedMedia } from './media.js';

test('partitionGroupedMedia keeps soundtrack audio out of the slide count', () => {
  const media = [
    { index: 0, kind: 'audio', path: 'post/soundtrack.mp3' },
    { index: 1, kind: 'image', path: 'post/image_1.jpg' },
    { index: 2, kind: 'image', path: 'post/image_2.jpg' },
  ];

  assert.deepEqual(partitionGroupedMedia(media), {
    slides: [media[1], media[2]],
    audioTracks: [media[0]],
  });
});

test('partitionGroupedMedia ignores unknown sidecar files', () => {
  const media = [
    { index: 0, kind: 'file', path: 'post/metadata.json' },
    { index: 1, kind: 'video', path: 'post/clip.mp4' },
  ];

  assert.deepEqual(partitionGroupedMedia(media), {
    slides: [media[1]],
    audioTracks: [],
  });
});
