/**
 * Channel repository — all SQL queries for the channels table.
 * Each function accepts database helpers (dbRun, dbGet, dbAll) for dependency injection.
 */

/**
 * List all channels with their post counts.
 * @param {Function} dbAll
 * @returns {Promise<Array>}
 */
export const listChannels = (dbAll) =>
  dbAll(`
    SELECT c.*, COUNT(p.id) as downloaded_count
    FROM channels c
    LEFT JOIN posts p ON c.id = p.channel_id
    GROUP BY c.id
    ORDER BY c.is_monitored DESC, c.id ASC
  `);

/**
 * Get a single channel by its ID (TikTok @handle).
 * @param {Function} dbGet
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const getChannelById = (dbGet, id) =>
  dbGet('SELECT * FROM channels WHERE id = ?', [id]).then((row) => row || null);

/**
 * Upsert a channel — inserts if not exists, updates url/username if it does.
 * @param {Function} dbRun
 * @param {Object} channel
 * @param {string} channel.id
 * @param {string} channel.username
 * @param {string} channel.url
 * @param {string} channel.created_at
 * @param {number} channel.is_monitored
 * @returns {Promise<void>}
 */
export const upsertChannel = (dbRun, channel) =>
  dbRun(
    'INSERT OR REPLACE INTO channels (id, username, url, created_at, is_monitored) VALUES (?, ?, ?, ?, ?)',
    [
      channel.id,
      channel.username,
      channel.url,
      channel.created_at,
      channel.is_monitored,
    ],
  );

/**
 * Set the is_monitored flag for a channel.
 * @param {Function} dbRun
 * @param {string} id
 * @param {number} isMonitored
 * @returns {Promise<void>}
 */
export const setMonitored = (dbRun, id, isMonitored) =>
  dbRun('UPDATE channels SET is_monitored = ? WHERE id = ?', [isMonitored, id]);

/**
 * Update the url for a channel and set it as monitored.
 * @param {Function} dbRun
 * @param {string} id
 * @param {string} url
 * @returns {Promise<void>}
 */
export const updateChannelUrl = (dbRun, id, url) =>
  dbRun('UPDATE channels SET is_monitored = 1, url = ? WHERE id = ?', [
    url,
    id,
  ]);

/**
 * Update the last_checked_at timestamp for a channel.
 * @param {Function} dbRun
 * @param {string} id
 * @returns {Promise<void>}
 */
export const updateLastChecked = (dbRun, id) =>
  dbRun('UPDATE channels SET last_checked_at = ? WHERE id = ?', [
    new Date().toISOString(),
    id,
  ]);

/**
 * Get all monitored channel URLs.
 * @param {Function} dbAll
 * @returns {Promise<Array<{url: string}>>}
 */
export const getMonitoredUrls = (dbAll) =>
  dbAll(
    'SELECT url FROM channels WHERE is_monitored = 1 ORDER BY username ASC',
  );

/**
 * Get all channels that are currently monitored.
 * @param {Function} dbAll
 * @returns {Promise<Array>}
 */
export const getMonitoredChannels = (dbAll) =>
  dbAll('SELECT * FROM channels WHERE is_monitored = 1');

/**
 * Delete a channel by ID (orphaned numeric channels).
 * @param {Function} dbRun
 * @param {string} id
 * @returns {Promise<void>}
 */
export const deleteChannel = (dbRun, id) =>
  dbRun('DELETE FROM channels WHERE id = ?', [id]);

/**
 * Count the number of posts for a given channel.
 * @param {Function} dbGet
 * @param {string} channelId
 * @returns {Promise<number>}
 */
export const countChannelPosts = (dbGet, channelId) =>
  dbGet('SELECT COUNT(*) as count FROM posts WHERE channel_id = ?', [
    channelId,
  ]).then((row) => (row ? row.count : 0));
