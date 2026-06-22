// Prefer codecs supported by all major browsers. An MP4 container can still
// contain HEVC/H.265, which Chromium and Firefox commonly cannot decode.
export const BROWSER_VIDEO_FORMAT = [
  'bestvideo[vcodec^=h264]+bestaudio[acodec^=aac]',
  'best[vcodec^=h264][acodec^=aac]',
  'bestvideo[vcodec^=h264]+bestaudio',
  'best[vcodec^=h264]',
].join('/');

export const buildBrowserVideoArgs = (outTemplate) => [
  '--format',
  BROWSER_VIDEO_FORMAT,
  '--merge-output-format',
  'mp4',
  '--write-thumbnail',
  '--no-playlist',
  '--no-warnings',
  '-o',
  outTemplate,
];
