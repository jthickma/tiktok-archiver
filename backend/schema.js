/**
 * @typedef {Object} Channel
 * @property {string} id - TikTok @handle (e.g. "@khaby.lame")
 * @property {string} username - Handle without @ prefix
 * @property {string} url - Canonical TikTok profile URL
 * @property {string} created_at - ISO 8601 timestamp
 * @property {string|null} last_checked_at - ISO 8601 or null
 * @property {number} is_monitored - 0 or 1
 * @property {number} [downloaded_count] - Joined from COUNT aggregation
 */

/**
 * @typedef {'video'|'slideshow'|'image'|'gallery'|'audio'|'media'} PostType
 */

/**
 * @typedef {Object} Post
 * @property {string} id - Unique post identifier
 * @property {string} channel_id - FK to channels.id
 * @property {PostType} type
 * @property {string|null} title
 * @property {string|null} description
 * @property {string} url - Source URL
 * @property {string} upload_date - YYYY-MM-DD
 * @property {string|null} file_path - Relative path within downloads dir
 * @property {string|null} thumbnail_path - Web-relative path to thumbnail
 * @property {string} downloaded_at - ISO 8601
 * @property {string|null} metadata_json - JSON blob
 */

/**
 * @typedef {'pending'|'downloading'|'completed'|'failed'|'cancelled'} JobStatus
 * @typedef {'channel'|'post'|'gallery-dl'} JobType
 */

/**
 * @typedef {Object} DownloadJob
 * @property {number} id
 * @property {string} url
 * @property {JobType} type
 * @property {JobStatus} status
 * @property {number} progress - 0-100
 * @property {string} log_output
 * @property {string|null} error_message
 * @property {string} created_at
 * @property {string|null} started_at
 * @property {string|null} completed_at
 * @property {number} attempt_count
 * @property {number} max_attempts
 * @property {string|null} next_attempt_at
 * @property {string|null} last_error_class
 * @property {string|null} cancelled_at
 */

/**
 * @typedef {Object} MediaFile
 * @property {number} index
 * @property {string} name
 * @property {string} path - Web-relative path
 * @property {'image'|'video'|'audio'|'file'} kind
 * @property {number} size - Bytes
 */

/**
 * @typedef {Object} SystemStatus
 * @property {Object} server - { startedAt, uptimeSeconds }
 * @property {Object} queue - { isProcessing, isPaused, activeJobIds, counts, activeCount, totalCount, problemCount }
 * @property {Object} monitor - { lastRunAt, nextRunAt, intervalMs, running }
 * @property {Object} tools - { ytDlp, galleryDl, ffmpeg }
 * @property {Object} storage - { dataDir, downloadsDir, dataDirWritable, downloadsDirWritable, disk }
 * @property {string} checkedAt
 */

/**
 * @typedef {Object} ApiErrorResponse
 * @property {Object} error
 * @property {string} error.code
 * @property {string} error.message
 */

/**
 * @typedef {Object} PostsQuery
 * @property {number} page
 * @property {number} limit
 * @property {number} offset
 * @property {string[]} channelIds
 * @property {string} type
 * @property {string} search
 * @property {string} sort
 * @property {'asc'|'desc'} direction
 * @property {string} dateFrom
 * @property {string} dateTo
 * @property {boolean} missingThumbnail
 */

/**
 * @typedef {Object} QueueQuery
 * @property {string} status
 * @property {string} type
 */

export {};
