import { safeSegment } from './utils/path-utils.js';

export const createProfileArchiveDirectory = (creator) => {
  const directory = safeSegment(String(creator || '').trim().replace(/^@/, ''));
  if (directory === '.' || directory === '..') {
    throw new Error('Invalid profile archive directory');
  }
  return directory;
};

const safePart = (value) => String(value || '')
  .trim()
  .replace(/[^a-zA-Z0-9@._-]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const createVideoArchiveBase = ({ creator, uploadDate, postId }) => {
  const safeCreator = safePart(String(creator || '').trim().replace(/^@/, ''));
  const safeUploadDate = safePart(uploadDate);
  const safePostId = safePart(postId);

  if (!safeCreator || !safePostId || !/^\d{4}-\d{2}-\d{2}$/.test(safeUploadDate)) {
    throw new Error('Video archive names require a creator, YYYY-MM-DD upload date, and post ID');
  }

  return `${safeCreator}${safeUploadDate}${safePostId}`;
};
