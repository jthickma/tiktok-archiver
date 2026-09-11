import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionGroupedMedia, resolvePageNavigation } from './media.js';

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

test('resolvePageNavigation waits for the requested page before selecting an edge item', () => {
  const oldPagePosts = [{ id: 'old-first' }, { id: 'old-last' }];
  const newPagePosts = [{ id: 'new-first' }, { id: 'new-last' }];
  const pending = { edge: 'first', page: 2 };

  assert.equal(resolvePageNavigation(pending, 1, oldPagePosts), null);
  assert.equal(resolvePageNavigation(pending, 2, newPagePosts), newPagePosts[0]);
  assert.equal(resolvePageNavigation({ edge: 'last', page: 2 }, 2, newPagePosts), newPagePosts[1]);
});


test('page navigation does not wrap on empty results or after cancellation', () => {
  assert.equal(resolvePageNavigation({ edge: 'first', page: 3 }, 3, []), null);
  assert.equal(resolvePageNavigation(null, 2, [{ id: 'old' }]), null);
});

test('page navigation supports the last partial page and reverse navigation', () => {
  const lastPage = [{ id: 'final-post' }];
  assert.equal(resolvePageNavigation({ edge: 'first', page: 3 }, 3, lastPage), lastPage[0]);
  const previousPage = [{ id: 'first' }, { id: 'last' }];
  assert.equal(resolvePageNavigation({ edge: 'last', page: 2 }, 2, previousPage), previousPage[1]);
});
