import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiError,
  parseDownloaderChoice,
  parseId,
  parsePostsQuery,
  parseQueueQuery,
  requireBodyString
} from '../validation.js';

test('requireBodyString trims non-empty string fields', () => {
  assert.equal(requireBodyString({ url: '  https://example.com/video  ' }, 'url'), 'https://example.com/video');
});

test('requireBodyString rejects missing or blank fields', () => {
  assert.throws(
    () => requireBodyString({ url: '   ' }, 'url'),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_BODY'
  );
});

test('parseDownloaderChoice defaults to auto and validates supported downloaders', () => {
  assert.equal(parseDownloaderChoice(undefined), 'auto');
  assert.equal(parseDownloaderChoice('gallery-dl'), 'gallery-dl');
  assert.throws(
    () => parseDownloaderChoice('yt-dlp'),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_BODY'
  );
});

test('parseId accepts only positive integer ids', () => {
  assert.equal(parseId('42'), 42);
  assert.throws(
    () => parseId('0'),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_ID'
  );
  assert.throws(
    () => parseId('abc'),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_ID'
  );
});

test('parsePostsQuery applies defaults and computes offset', () => {
  assert.deepEqual(parsePostsQuery({}), {
    page: 1,
    limit: 24,
    offset: 0,
    channelIds: [],
    type: '',
    search: '',
    sort: 'upload_date',
    direction: 'desc',
    dateFrom: '',
    dateTo: '',
    missingThumbnail: false
  });

  assert.deepEqual(parsePostsQuery({
    page: '3',
    limit: '10',
    channel_id: '@one,@two',
    type: 'video',
    search: ' query ',
    sort: 'title',
    direction: 'asc',
    date_from: '2026-01-01',
    date_to: '2026-01-31',
    missing_thumbnail: '1'
  }), {
    page: 3,
    limit: 10,
    offset: 20,
    channelIds: ['@one', '@two'],
    type: 'video',
    search: 'query',
    sort: 'title',
    direction: 'asc',
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    missingThumbnail: true
  });
});

test('parsePostsQuery rejects out-of-bounds pagination and unsupported filters', () => {
  assert.throws(
    () => parsePostsQuery({ page: '0' }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_QUERY'
  );
  assert.throws(
    () => parsePostsQuery({ limit: '101' }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_QUERY'
  );
  assert.throws(
    () => parsePostsQuery({ type: 'unknown' }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_QUERY'
  );
  assert.throws(
    () => parsePostsQuery({ sort: 'random' }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_QUERY'
  );
});

test('parseQueueQuery accepts supported status and type filters', () => {
  assert.deepEqual(parseQueueQuery({}), { status: '', type: '' });
  assert.deepEqual(parseQueueQuery({ status: 'failed', type: 'gallery-dl' }), {
    status: 'failed',
    type: 'gallery-dl'
  });
});

test('parseQueueQuery rejects unsupported status and type filters', () => {
  assert.throws(
    () => parseQueueQuery({ status: 'running' }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_QUERY'
  );
  assert.throws(
    () => parseQueueQuery({ type: 'video' }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_QUERY'
  );
});
