export const groupedMediaTypes = new Set(['slideshow', 'gallery']);

export const isGroupedMedia = (type) => groupedMediaTypes.has(type);

export const fallbackThumb = (type) => {
  const label = type === 'slideshow' ? 'SLIDES' : type === 'gallery' ? 'GALLERY' : type === 'image' ? 'IMAGE' : type === 'audio' ? 'AUDIO' : 'VIDEO';
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 420'%3E%3Crect width='320' height='420' fill='%2313171f'/%3E%3Ccircle cx='160' cy='178' r='46' fill='%2328313d'/%3E%3Ctext x='160' y='258' text-anchor='middle' fill='%2398a2b3' font-family='Arial' font-size='22'%3E${label}%3C/text%3E%3C/svg%3E`;
};

export const displaySource = (channelId) => channelId?.startsWith('@') ? channelId : channelId || 'unknown source';

export const avatarText = (channelId) => displaySource(channelId).replace(/^@/, '').slice(0, 2).toUpperCase();

export const getAvatarColor = (username) => {
  if (!username) return 'linear-gradient(135deg, #27d3c3, #6aa7ff)';
  const clean = username.replace(/^@/, '');
  let hash = 0;
  for (let i = 0; i < clean.length; i += 1) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    'linear-gradient(135deg, #27d3c3, #0d9488)',
    'linear-gradient(135deg, #f0526d, #b91c1c)',
    'linear-gradient(135deg, #6aa7ff, #1d4ed8)',
    'linear-gradient(135deg, #f0b83a, #b45309)',
    'linear-gradient(135deg, #a855f7, #6b21a8)',
    'linear-gradient(135deg, #ec4899, #be185d)',
    'linear-gradient(135deg, #10b981, #047857)'
  ];
  return colors[Math.abs(hash) % colors.length];
};

export const readableUrl = (value) => {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'tiktok.com') {
      const handle = parts.find((part) => part.startsWith('@'));
      const videoIndex = parts.indexOf('video');
      if (handle && videoIndex >= 0 && parts[videoIndex + 1]) return `${handle} / ${parts[videoIndex + 1]}`;
      if (handle) return handle;
    }
    return `${host}${url.pathname === '/' ? '' : url.pathname}`.replace(/\/$/, '');
  } catch {
    return value;
  }
};
