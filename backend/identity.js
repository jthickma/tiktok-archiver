export const normalizeHandle = (input) => {
  const value = String(input || '').trim();
  const match = value.match(/@?([a-zA-Z0-9_.-]{2,24})/);
  if (!match) {
    throw new Error('Invalid TikTok handle');
  }
  const handle = match[1].replace(/^@/, '');
  if (/^\d+$/.test(handle)) {
    throw new Error('TikTok numeric profile IDs are not valid usernames');
  }
  return `@${handle}`;
};

export const normalizeProfileUrl = (input) => {
  const value = String(input || '').trim();
  if (!value) {
    throw new Error('Profile URL or handle is required');
  }

  if (value.startsWith('@')) {
    return `https://www.tiktok.com/${normalizeHandle(value)}`;
  }

  if (!/^https?:\/\//i.test(value)) {
    return `https://www.tiktok.com/${normalizeHandle(value)}`;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL is invalid');
  }
  if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) {
    throw new Error('Only TikTok URLs are supported');
  }

  const handleMatch = url.pathname.match(/\/@([a-zA-Z0-9_.-]+)/);
  if (!handleMatch) {
    throw new Error('TikTok profile URL must include an @handle');
  }

  return `https://www.tiktok.com/${normalizeHandle(handleMatch[1])}`;
};

export const canonicalizeTikTokUrl = (input) => {
  const value = String(input || '').trim();
  if (!value) {
    throw new Error('URL is required');
  }

  if (value.startsWith('@')) {
    return normalizeProfileUrl(value);
  }

  if (!/^https?:\/\//i.test(value)) {
    return normalizeProfileUrl(value);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL is invalid');
  }
  if (!/(^|\.)tiktok\.com$/i.test(url.hostname)) {
    throw new Error('Only TikTok URLs are supported');
  }

  url.hash = '';
  return url.toString();
};

export const canonicalizeHttpUrl = (input) => {
  const value = String(input || '').trim();
  if (!value) {
    throw new Error('URL is required');
  }

  if (value.startsWith('@') || !/^https?:\/\//i.test(value)) {
    return canonicalizeTikTokUrl(value);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported');
  }
  url.hash = '';
  return url.toString();
};

export const canonicalizeStrictHttpUrl = (input) => {
  const value = String(input || '').trim();
  if (!value) {
    throw new Error('URL is required');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported');
  }
  url.hash = '';
  return url.toString();
};

export const isTikTokUrl = (input) => {
  try {
    const url = new URL(input);
    return /(^|\.)tiktok\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
};

export const extractUsername = (url, metadata = {}) => {
  const urlCandidates = [
    metadata.webpage_url,
    url,
    metadata.original_url
  ].filter(Boolean);

  for (const candidate of urlCandidates) {
    const match = String(candidate).match(/@([a-zA-Z0-9_.-]+)/);
    if (match && !/^\d+$/.test(match[1])) {
      return normalizeHandle(match[1]);
    }
  }

  const metadataCandidates = [metadata.uploader, metadata.channel, metadata.creator];
  for (const candidate of metadataCandidates) {
    const value = String(candidate || '').trim();
    if (/^[a-zA-Z0-9_.-]{2,24}$/.test(value) && !/^\d+$/.test(value)) {
      return normalizeHandle(value);
    }
  }

  return '@unknown';
};

export const requireTikTokUsername = (url, metadata = {}) => {
  const username = extractUsername(url, metadata);
  if (username === '@unknown' || /^@\d+$/.test(username)) {
    throw new Error('Unable to determine the TikTok username; refusing to create a numeric or unknown profile folder');
  }
  return username;
};

export const detectUrlType = (input, options = {}) => {
  if (options.downloader === 'gallery-dl') {
    return {
      url: canonicalizeStrictHttpUrl(input),
      type: 'gallery-dl'
    };
  }

  const normalized = canonicalizeHttpUrl(input);
  const clean = normalized.split('?')[0].replace(/\/+$/, '');
  const isProfile = isTikTokUrl(normalized) && /\/@[a-zA-Z0-9_.-]+$/i.test(clean);
  return {
    url: normalized,
    type: isProfile ? 'channel' : 'post'
  };
};
