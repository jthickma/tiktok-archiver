/**
 * Job repository — all SQL queries for download_jobs and download_job_logs tables.
 * Each function accepts database helpers (dbRun, dbGet, dbAll) for dependency injection.
 */

const JOB_TYPES = new Set(['channel', 'post', 'gallery-dl']);
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];
const ACTIVE_STATUSES = ['pending', 'downloading'];
const LOG_CAP = 200000;

/**
 * Validate that a job type is supported.
 * @param {string} type
 * @throws {Error}
 */
const validateJobType = (type) => {
  if (!JOB_TYPES.has(type)) {
    const error = new Error(`Unsupported job type: ${type}`);
    error.statusCode = 400;
    error.code = 'INVALID_JOB_TYPE';
    throw error;
  }
};

/**
 * Append a log entry to the download_job_logs table and update the job's log_output.
 * @param {Function} dbRun
 * @param {number} jobId
 * @param {string} time
 * @param {string} level
 * @param {string} message
 */
const appendLog = (dbRun, jobId, time, level, message) =>
  dbRun(
    'INSERT INTO download_job_logs (job_id, created_at, level, message) VALUES (?, ?, ?, ?)',
    [jobId, time, level, message],
  );

/**
 * Update a job's status with progress, log output, and optional error.
 * @param {Function} dbRun
 * @param {number} jobId
 * @param {number} progress
 * @param {string} status
 * @param {string} [statusText='']
 * @param {string|null} [errorMsg=null]
 */
export const updateJobStatus = async (
  dbRun,
  jobId,
  progress,
  status,
  statusText = '',
  errorMsg = null,
) => {
  const time = new Date().toISOString();
  const logText = statusText || (errorMsg ? `ERROR: ${errorMsg}` : '');

  if (logText) {
    await appendLog(
      dbRun,
      jobId,
      time,
      status === 'failed' ? 'error' : 'info',
      logText,
    );
  }

  if (status === 'downloading') {
    await dbRun(
      `UPDATE download_jobs
       SET progress = ?, status = ?, log_output = substr(log_output || ?, -?), started_at = COALESCE(started_at, ?)
       WHERE id = ?`,
      [progress, status, `[${time}] ${statusText}\n`, LOG_CAP, time, jobId],
    );
  } else if (status === 'completed') {
    await dbRun(
      `UPDATE download_jobs
       SET progress = 100, status = ?, log_output = substr(log_output || ?, -?), completed_at = ?, next_attempt_at = NULL
       WHERE id = ?`,
      [status, `[${time}] Job completed successfully.\n`, LOG_CAP, time, jobId],
    );
  } else if (status === 'failed') {
    await dbRun(
      `UPDATE download_jobs
       SET status = ?, log_output = substr(log_output || ?, -?), error_message = ?, completed_at = ?
       WHERE id = ?`,
      [
        status,
        `[${time}] ERROR: ${errorMsg}\n`,
        LOG_CAP,
        errorMsg,
        time,
        jobId,
      ],
    );
  } else if (status === 'cancelled') {
    await dbRun(
      `UPDATE download_jobs
       SET status = ?, log_output = substr(log_output || ?, -?), error_message = ?, completed_at = ?, cancelled_at = ?
       WHERE id = ?`,
      [
        status,
        `[${time}] CANCELLED: ${statusText || 'Job cancelled'}\n`,
        LOG_CAP,
        statusText || 'Job cancelled',
        time,
        time,
        jobId,
      ],
    );
  } else {
    await dbRun(
      `UPDATE download_jobs SET status = ?, progress = ? WHERE id = ?`,
      [status, progress, jobId],
    );
  }
};

/**
 * Enqueue a new download job.
 * @param {Function} dbRun
 * @param {Function} dbGet
 * @param {string} url
 * @param {string} type
 * @param {Object} [options={}]
 * @param {number} [options.maxAttempts=3]
 * @returns {Promise<Object>} Job result with id, url, type, status
 */
export const enqueueJob = async (dbRun, dbGet, url, type, options = {}) => {
  validateJobType(type);

  const time = new Date().toISOString();
  try {
    const result = await dbRun(
      `INSERT INTO download_jobs (url, type, status, created_at, max_attempts) VALUES (?, ?, ?, ?, ?)`,
      [url, type, 'pending', time, options.maxAttempts || 3],
    );
    return {
      id: result.lastID,
      url,
      type,
      status: 'pending',
      created: true,
      requeued: false,
    };
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      const existingJob = await dbGet(
        'SELECT * FROM download_jobs WHERE url = ?',
        [url],
      );
      if (existingJob && TERMINAL_STATUSES.includes(existingJob.status)) {
        await dbRun(
          `UPDATE download_jobs
           SET type = ?, status = 'pending', progress = 0, log_output = '', error_message = NULL,
               created_at = ?, started_at = NULL, completed_at = NULL, attempt_count = 0,
               next_attempt_at = NULL, last_error_class = NULL, cancelled_at = NULL
           WHERE id = ?`,
          [type, time, existingJob.id],
        );
        return {
          id: existingJob.id,
          url,
          type,
          status: 'pending',
          created: false,
          requeued: true,
          previousStatus: existingJob.status,
        };
      }
      if (existingJob) {
        return {
          id: existingJob.id,
          url,
          type: existingJob.type,
          status: existingJob.status,
          created: false,
          requeued: false,
        };
      }
      throw err;
    }
    throw err;
  }
};

/**
 * Get the next pending job (by priority and scheduled time).
 * @param {Function} dbGet
 * @returns {Promise<Object|null>}
 */
export const getNextPendingJob = (dbGet) =>
  dbGet(
    `SELECT * FROM download_jobs
     WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY id ASC LIMIT 1`,
    [new Date().toISOString()],
  );

/**
 * Update a job with arbitrary fields.
 * @param {Function} dbRun
 * @param {number} id
 * @param {Object} fields - Key-value pairs to set
 * @returns {Promise<void>}
 */
export const updateJob = (dbRun, id, fields) => {
  const entries = Object.entries(fields);
  if (entries.length === 0) return Promise.resolve();
  const setClauses = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value);
  return dbRun(`UPDATE download_jobs SET ${setClauses} WHERE id = ?`, [
    ...values,
    id,
  ]);
};

/**
 * List active and history jobs with optional filtering.
 * @param {Function} dbAll
 * @param {Object} [query={}]
 * @returns {Promise<{active: Array, history: Array, summary: Object}>}
 */
export const listJobs = (dbAll, query = {}) => {
  const historyWhere = [];
  const historyParams = [];
  const activeWhere = ["status IN ('pending', 'downloading')"];
  const activeParams = [];

  if (query.status && ACTIVE_STATUSES.includes(query.status)) {
    activeWhere.splice(0, activeWhere.length, 'status = ?');
    activeParams.push(query.status);
  } else if (query.status) {
    historyWhere.push('status = ?');
    historyParams.push(query.status);
  }

  if (query.type) {
    historyWhere.push('type = ?');
    historyParams.push(query.type);
    activeWhere.push('type = ?');
    activeParams.push(query.type);
  }

  const historySuffix = historyWhere.length
    ? `WHERE ${historyWhere.join(' AND ')}`
    : '';

  const activeFields = [
    'id',
    'url',
    'type',
    'status',
    'progress',
    'error_message',
    'created_at',
    'started_at',
    'completed_at',
    'attempt_count',
    'max_attempts',
    'next_attempt_at',
    'last_error_class',
  ].join(', ');

  const historyFields = activeFields;

  const activePromise = dbAll(
    `SELECT ${activeFields} FROM download_jobs
     WHERE ${activeWhere.join(' AND ')}
     ORDER BY CASE status WHEN 'downloading' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, id ASC`,
    activeParams,
  );

  const historyPromise = dbAll(
    `SELECT ${historyFields} FROM download_jobs ${historySuffix}
     ${historySuffix ? 'AND' : 'WHERE'} status IN ('completed', 'failed', 'cancelled')
     ORDER BY completed_at DESC, id DESC LIMIT 100`,
    historyParams,
  );

  return Promise.all([activePromise, historyPromise]).then(
    ([active, history]) => ({
      active,
      history,
    }),
  );
};

/**
 * Get a single job by ID.
 * @param {Function} dbGet
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
export const getJobById = (dbGet, id) =>
  dbGet('SELECT * FROM download_jobs WHERE id = ?', [id]).then(
    (row) => row || null,
  );

/**
 * Get logs and error for a job by ID.
 * @param {Function} dbAll
 * @param {Function} dbGet
 * @param {number} id
 * @returns {Promise<{logs: string, error: string|null, status: string}>}
 */
export const getJobLogs = async (dbAll, dbGet, id) => {
  const job = await dbGet(
    'SELECT log_output, error_message, status FROM download_jobs WHERE id = ?',
    [id],
  );
  if (!job) {
    const error = new Error('Job not found');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  const rows = await dbAll(
    'SELECT created_at, level, message FROM download_job_logs WHERE job_id = ? ORDER BY id DESC LIMIT 250',
    [id],
  );

  return {
    logs:
      rows
        .reverse()
        .map((row) => `[${row.created_at}] ${row.message}`)
        .join('\n') ||
      job.log_output ||
      '',
    error: job.error_message,
    status: job.status,
  };
};

/**
 * Cancel an active job.
 * @param {Function} dbGet
 * @param {Function} dbRun
 * @param {number} id
 * @returns {Promise<Object>} The job before cancellation
 */
export const cancelJob = async (dbGet, dbRun, id) => {
  const job = await dbGet('SELECT * FROM download_jobs WHERE id = ?', [id]);
  if (!job) {
    const error = new Error('Job not found');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }
  if (TERMINAL_STATUSES.includes(job.status)) {
    const error = new Error('Job is already finished');
    error.statusCode = 409;
    error.code = 'JOB_NOT_ACTIVE';
    throw error;
  }
  return job;
};

/**
 * Retry a failed/cancelled job.
 * @param {Function} dbRun
 * @param {number} id
 * @returns {Promise<void>}
 */
export const retryJob = (dbRun, id) =>
  dbRun(
    `UPDATE download_jobs
     SET status = 'pending', progress = 0, error_message = NULL, completed_at = NULL,
         next_attempt_at = NULL, last_error_class = NULL, cancelled_at = NULL
     WHERE id = ?`,
    [id],
  );

/**
 * Delete a job (if not currently downloading).
 * @param {Function} dbRun
 * @param {number} id
 * @returns {Promise<number>} changes count (0 if job was active)
 */
export const deleteJob = async (dbRun, id) => {
  await dbRun('DELETE FROM download_job_logs WHERE job_id = ?', [id]);
  const result = await dbRun(
    "DELETE FROM download_jobs WHERE id = ? AND status != 'downloading'",
    [id],
  );
  return result.changes || 0;
};

/**
 * Clear all completed and cancelled jobs.
 * @param {Function} dbRun
 * @returns {Promise<{changes: number}>}
 */
export const clearCompletedJobs = async (dbRun) => {
  await dbRun(
    `DELETE FROM download_job_logs
     WHERE job_id IN (SELECT id FROM download_jobs WHERE status IN ('completed', 'cancelled'))`,
  );
  return dbRun(
    "DELETE FROM download_jobs WHERE status IN ('completed', 'cancelled')",
  );
};

/**
 * Recover jobs that were interrupted (status 'downloading' on startup).
 * @param {Function} dbAll
 * @param {Function} dbRun
 * @returns {Promise<number>} Number of recovered jobs
 */
export const recoverInterruptedJobs = async (dbAll, dbRun) => {
  const jobs = await dbAll(
    "SELECT id, type FROM download_jobs WHERE status = 'downloading'",
  );
  const time = new Date().toISOString();
  for (const job of jobs) {
    await dbRun(
      `UPDATE download_jobs
       SET status = 'pending', progress = 0, next_attempt_at = NULL, started_at = NULL,
           log_output = substr(log_output || ?, -?)
       WHERE id = ?`,
      [
        `[${time}] Recovered interrupted ${job.type} job after server restart.\n`,
        LOG_CAP,
        job.id,
      ],
    );
    await appendLog(
      dbRun,
      job.id,
      time,
      'warn',
      `Recovered interrupted ${job.type} job after server restart.`,
    );
  }
  return jobs.length;
};

/**
 * Get queue summary counts.
 * @param {Function} dbAll
 * @returns {Promise<Object>}
 */
export const getQueueSummary = async (dbAll) => {
  const rows = await dbAll(
    'SELECT status, COUNT(*) as count FROM download_jobs GROUP BY status',
  );

  const counts = {
    pending: 0,
    downloading: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    if (counts[row.status] !== undefined) {
      counts[row.status] = row.count;
    }
  }

  return {
    counts,
    activeCount: counts.pending + counts.downloading,
    totalCount: Object.values(counts).reduce(
      (total, count) => total + count,
      0,
    ),
    problemCount: counts.failed,
  };
};

/**
 * Check if there's a pending job due to run.
 * @param {Function} dbGet
 * @returns {Promise<Object|null>}
 */
export const getDueJob = (dbGet) =>
  dbGet(
    `SELECT id FROM download_jobs
     WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) LIMIT 1`,
    [new Date().toISOString()],
  );

/**
 * Increment the attempt count for a job.
 * @param {Function} dbRun
 * @param {number} id
 * @returns {Promise<void>}
 */
export const incrementAttempt = (dbRun, id) =>
  dbRun(
    'UPDATE download_jobs SET attempt_count = COALESCE(attempt_count, 0) + 1 WHERE id = ?',
    [id],
  );

/**
 * Schedule a retry with backoff.
 * @param {Function} dbRun
 * @param {number} jobId
 * @param {string} errorMessage
 * @param {string} errorClass
 * @param {number} attemptCount
 * @returns {Promise<void>}
 */
export const scheduleRetry = async (
  dbRun,
  jobId,
  errorMessage,
  errorClass,
  attemptCount,
) => {
  const backoffSeconds = Math.min(
    15 * 2 ** Math.max(0, attemptCount - 1),
    15 * 60,
  );
  const retryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
  const time = new Date().toISOString();

  await dbRun(
    `UPDATE download_jobs
     SET status = 'pending', progress = 0, error_message = ?, next_attempt_at = ?,
         last_error_class = ?, log_output = substr(log_output || ?, -?)
     WHERE id = ?`,
    [
      errorMessage,
      retryAt,
      errorClass,
      `[${time}] ERROR: ${errorMessage}\nRetrying at ${retryAt}.\n`,
      LOG_CAP,
      jobId,
    ],
  );
  await appendLog(
    dbRun,
    jobId,
    time,
    'warn',
    `Retry scheduled at ${retryAt} after ${errorClass} failure.`,
  );
};

/**
 * Mark a job as failed (non-retryable).
 * @param {Function} dbRun
 * @param {number} jobId
 * @param {string} errorClass
 * @param {string} errorMessage
 * @returns {Promise<void>}
 */
export const markJobFailed = async (dbRun, jobId, errorClass, errorMessage) => {
  await dbRun('UPDATE download_jobs SET last_error_class = ? WHERE id = ?', [
    errorClass,
    jobId,
  ]);
  await updateJobStatus(
    dbRun,
    jobId,
    0,
    'failed',
    '',
    errorMessage || 'Unknown error occurred.',
  );
};

/**
 * The error classification logic extracted from queue.js.
 * @param {Error} error
 * @returns {string}
 */
export const classifyError = (error) => {
  const message = error?.message || '';
  if (/cancelled|canceled/i.test(message)) return 'cancelled';
  if (/invalid|unsupported|validation|must include|only tiktok/i.test(message))
    return 'validation';
  if (/rate|429|too many requests/i.test(message)) return 'rate_limit';
  if (/timed out|timeout|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message))
    return 'network';
  return 'tool';
};

/**
 * Check if an error class is retryable.
 * @param {string} errorClass
 * @returns {boolean}
 */
export const isRetryable = (errorClass) =>
  !['validation', 'cancelled'].includes(errorClass);
