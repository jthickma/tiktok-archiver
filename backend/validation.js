export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const sendError = (res, error) => {
  const status = error.status || 500;
  const code = error.code || (status >= 500 ? 'SERVER_ERROR' : 'BAD_REQUEST');
  res.status(status).json({
    error: {
      code,
      message: error.message || 'Unexpected server error'
    }
  });
};

export const requireBodyString = (body, field) => {
  const value = body?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'INVALID_BODY', `${field} is required`);
  }
  return value.trim();
};

export const parseDownloaderChoice = (value) => {
  const downloader = String(value || 'auto').trim();
  const allowedDownloaders = new Set(['auto', 'gallery-dl']);
  if (!allowedDownloaders.has(downloader)) {
    throw new ApiError(400, 'INVALID_BODY', 'downloader is not supported');
  }
  return downloader;
};

export const parseId = (value, name = 'id') => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, 'INVALID_ID', `${name} must be a positive integer`);
  }
  return parsed;
};

export const parsePostsQuery = (query) => {
  const page = Number.parseInt(query.page || '1', 10);
  const limit = Number.parseInt(query.limit || '24', 10);
  if (!Number.isInteger(page) || page < 1) {
    throw new ApiError(400, 'INVALID_QUERY', 'page must be a positive integer');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, 'INVALID_QUERY', 'limit must be between 1 and 100');
  }

  const allowedTypes = new Set(['', 'video', 'slideshow', 'image', 'gallery', 'audio', 'media']);
  const type = String(query.type || '').trim();
  if (!allowedTypes.has(type)) {
    throw new ApiError(400, 'INVALID_QUERY', 'type is not supported');
  }

  const allowedSorts = new Set(['upload_date', 'downloaded_at', 'profile', 'type', 'title']);
  const sort = String(query.sort || 'upload_date').trim();
  if (!allowedSorts.has(sort)) {
    throw new ApiError(400, 'INVALID_QUERY', 'sort is not supported');
  }

  const direction = String(query.direction || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    channelIds: String(query.channel_id || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    type,
    search: String(query.search || '').trim(),
    sort,
    direction,
    dateFrom: String(query.date_from || '').trim(),
    dateTo: String(query.date_to || '').trim(),
    missingThumbnail: String(query.missing_thumbnail || '') === '1'
  };
};

export const parseQueueQuery = (query) => {
  const status = String(query.status || '').trim();
  const type = String(query.type || '').trim();
  const allowedStatuses = new Set(['', 'pending', 'downloading', 'completed', 'failed', 'cancelled']);
  const allowedTypes = new Set(['', 'channel', 'post', 'gallery-dl']);

  if (!allowedStatuses.has(status)) {
    throw new ApiError(400, 'INVALID_QUERY', 'status is not supported');
  }
  if (!allowedTypes.has(type)) {
    throw new ApiError(400, 'INVALID_QUERY', 'type is not supported');
  }

  return { status, type };
};
