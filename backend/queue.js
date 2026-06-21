import { dbRun, dbGet, dbAll } from './database.js';
import { downloadPost, downloadWithGalleryDl, scanProfile } from './downloader.js';
import { requireTikTokUsername } from './identity.js';
import { logger } from './logger.js';
import { ApiError } from './validation.js';

let isProcessing = false;
let isPaused = false;
const activeProcesses = new Map();
const LOG_CAP = 200000;
const JOB_TYPES = new Set(['channel', 'post', 'gallery-dl']);

const jobTypeLabel = (type) => {
  if (type === 'channel') return 'profile scan';
  if (type === 'gallery-dl') return 'gallery-dl download';
  return 'download';
};

const classifyError = (error) => {
  const message = error?.message || '';
  if (/cancelled|canceled/i.test(message)) return 'cancelled';
  if (/invalid|unsupported|validation|must include|only tiktok/i.test(message)) return 'validation';
  if (/rate|429|too many requests/i.test(message)) return 'rate_limit';
  if (/timed out|timeout|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message)) return 'network';
  return 'tool';
};

const isRetryable = (errorClass) => !['validation', 'cancelled'].includes(errorClass);

const nextBackoffDate = (attemptCount) => {
  const seconds = Math.min(15 * (2 ** Math.max(0, attemptCount - 1)), 15 * 60);
  return new Date(Date.now() + seconds * 1000).toISOString();
};

// Append text to a job's log output and update progress
const updateJobStatus = async (jobId, progress, status, statusText = '', errorMsg = null) => {
  const time = new Date().toISOString();
  const logText = statusText || (errorMsg ? `ERROR: ${errorMsg}` : '');
  if (logText) {
    await dbRun(
      'INSERT INTO download_job_logs (job_id, created_at, level, message) VALUES (?, ?, ?, ?)',
      [jobId, time, status === 'failed' ? 'error' : 'info', logText]
    );
  }
  
  if (status === 'downloading') {
    await dbRun(
      `UPDATE download_jobs 
       SET progress = ?, status = ?, log_output = substr(log_output || ?, -?), started_at = COALESCE(started_at, ?)
       WHERE id = ?`,
      [progress, status, `[${time}] ${statusText}\n`, LOG_CAP, time, jobId]
    );
  } else if (status === 'completed') {
    await dbRun(
      `UPDATE download_jobs 
       SET progress = 100, status = ?, log_output = substr(log_output || ?, -?), completed_at = ?, next_attempt_at = NULL
       WHERE id = ?`,
      [status, `[${time}] Job completed successfully.\n`, LOG_CAP, time, jobId]
    );
  } else if (status === 'failed') {
    await dbRun(
      `UPDATE download_jobs 
       SET status = ?, log_output = substr(log_output || ?, -?), error_message = ?, completed_at = ?
       WHERE id = ?`,
      [status, `[${time}] ERROR: ${errorMsg}\n`, LOG_CAP, errorMsg, time, jobId]
    );
  } else if (status === 'cancelled') {
    await dbRun(
      `UPDATE download_jobs
       SET status = ?, log_output = substr(log_output || ?, -?), error_message = ?, completed_at = ?, cancelled_at = ?
       WHERE id = ?`,
      [status, `[${time}] CANCELLED: ${statusText || 'Job cancelled'}\n`, LOG_CAP, statusText || 'Job cancelled', time, time, jobId]
    );
  } else {
    await dbRun(
      `UPDATE download_jobs SET status = ?, progress = ? WHERE id = ?`,
      [status, progress, jobId]
    );
  }
};

// Queue a new URL for downloading
export const enqueue = async (url, type, options = {}) => {
  if (!JOB_TYPES.has(type)) {
    throw new ApiError(400, 'INVALID_JOB_TYPE', 'Job type is not supported');
  }

  const time = new Date().toISOString();
  try {
    const result = await dbRun(
      `INSERT INTO download_jobs (url, type, status, created_at, max_attempts) VALUES (?, ?, ?, ?, ?)`,
      [url, type, 'pending', time, options.maxAttempts || 3]
    );
    // Trigger queue processing
    processQueue();
    return {
      id: result.lastID,
      url,
      type,
      status: 'pending',
      created: true,
      requeued: false
    };
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      // If job is already present but in completed/failed/pending state, we might reset it if failed,
      // or ignore if completed. Let's see: if it's failed, reset to pending.
      const existingJob = await dbGet('SELECT * FROM download_jobs WHERE url = ?', [url]);
      if (existingJob && ['failed', 'completed', 'cancelled'].includes(existingJob.status)) {
        await dbRun(
          `UPDATE download_jobs 
           SET type = ?, status = 'pending', progress = 0, log_output = '', error_message = NULL,
               created_at = ?, started_at = NULL, completed_at = NULL, attempt_count = 0,
               next_attempt_at = NULL, last_error_class = NULL, cancelled_at = NULL
           WHERE id = ?`,
          [type, time, existingJob.id]
        );
        processQueue();
        return {
          id: existingJob.id,
          url,
          type,
          status: 'pending',
          created: false,
          requeued: true,
          previousStatus: existingJob.status
        };
      }
      if (existingJob) {
        return {
          id: existingJob.id,
          url,
          type: existingJob.type,
          status: existingJob.status,
          created: false,
          requeued: false
        };
      }
      throw err;
    } else {
      logger.error('failed to enqueue job', { error: err, url, type });
      throw err;
    }
  }
};

export const recoverInterruptedJobs = async () => {
  const jobs = await dbAll("SELECT id, type FROM download_jobs WHERE status = 'downloading'");
  for (const job of jobs) {
    const time = new Date().toISOString();
    await dbRun(
      `UPDATE download_jobs
       SET status = 'pending', progress = 0, next_attempt_at = NULL, started_at = NULL,
           log_output = substr(log_output || ?, -?)
       WHERE id = ?`,
      [`[${time}] Recovered interrupted ${job.type} job after server restart.\n`, LOG_CAP, job.id]
    );
    await dbRun(
      'INSERT INTO download_job_logs (job_id, created_at, level, message) VALUES (?, ?, ?, ?)',
      [job.id, time, 'warn', `Recovered interrupted ${job.type} job after server restart.`]
    );
  }
  if (jobs.length > 0) {
    logger.warn('recovered interrupted queue jobs', { count: jobs.length });
  }
  return jobs.length;
};

export const pauseQueue = () => {
  isPaused = true;
  logger.info('queue paused');
};

export const resumeQueue = () => {
  isPaused = false;
  logger.info('queue resumed');
  processQueue();
};

export const getQueueState = () => ({
  isProcessing,
  isPaused,
  activeJobIds: Array.from(activeProcesses.keys())
});

const emptyQueueCounts = () => ({
  pending: 0,
  downloading: 0,
  completed: 0,
  failed: 0,
  cancelled: 0
});

export const readQueueSummary = async () => {
  const rows = await dbAll('SELECT status, COUNT(*) as count FROM download_jobs GROUP BY status');
  const counts = emptyQueueCounts();
  for (const row of rows) {
    counts[row.status] = row.count;
  }

  return {
    counts,
    activeCount: counts.pending + counts.downloading,
    totalCount: Object.values(counts).reduce((total, count) => total + count, 0),
    problemCount: counts.failed
  };
};

export const listQueueJobs = async ({ status, type } = {}) => {
  const historyWhere = [];
  const historyParams = [];
  const activeWhere = ["status IN ('pending', 'downloading')"];
  const activeParams = [];

  if (status && ['pending', 'downloading'].includes(status)) {
    activeWhere.splice(0, activeWhere.length, 'status = ?');
    activeParams.push(status);
  } else if (status) {
    historyWhere.push('status = ?');
    historyParams.push(status);
  }

  if (type) {
    historyWhere.push('type = ?');
    historyParams.push(type);
    activeWhere.push('type = ?');
    activeParams.push(type);
  }

  const historySuffix = historyWhere.length ? `WHERE ${historyWhere.join(' AND ')}` : '';
  const active = await dbAll(
    `SELECT id, url, type, status, progress, error_message, created_at, started_at, completed_at,
            attempt_count, max_attempts, next_attempt_at, last_error_class
     FROM download_jobs
     WHERE ${activeWhere.join(' AND ')}
     ORDER BY CASE status WHEN 'downloading' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, id ASC`,
    activeParams
  );
  const history = await dbAll(
    `SELECT id, url, type, status, progress, error_message, created_at, started_at, completed_at,
            attempt_count, max_attempts, next_attempt_at, last_error_class
     FROM download_jobs ${historySuffix}
     ${historySuffix ? 'AND' : 'WHERE'} status IN ('completed', 'failed', 'cancelled')
     ORDER BY completed_at DESC, id DESC LIMIT 100`,
    historyParams
  );

  return {
    active,
    history,
    state: getQueueState(),
    summary: await readQueueSummary()
  };
};

export const readJobLogs = async (jobId) => {
  const job = await dbGet('SELECT log_output, error_message, status FROM download_jobs WHERE id = ?', [jobId]);
  if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found');

  const rows = await dbAll(
    'SELECT created_at, level, message FROM download_job_logs WHERE job_id = ? ORDER BY id DESC LIMIT 250',
    [jobId]
  );

  return {
    logs: rows.reverse().map((row) => `[${row.created_at}] ${row.message}`).join('\n') || job.log_output || '',
    error: job.error_message,
    status: job.status
  };
};

export const cancelJob = async (jobId) => {
  const job = await dbGet('SELECT * FROM download_jobs WHERE id = ?', [jobId]);
  if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    throw new ApiError(409, 'JOB_NOT_ACTIVE', 'Job is already finished');
  }

  const proc = activeProcesses.get(jobId);
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 5000);
  }

  await updateJobStatus(jobId, job.progress || 0, 'cancelled', 'Cancelled by user');
};

export const retryJob = async (jobId) => {
  const job = await dbGet('SELECT * FROM download_jobs WHERE id = ?', [jobId]);
  if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
  await dbRun(
    `UPDATE download_jobs
     SET status = 'pending', progress = 0, error_message = NULL, completed_at = NULL,
         next_attempt_at = NULL, last_error_class = NULL, cancelled_at = NULL
     WHERE id = ?`,
    [jobId]
  );
  await updateJobStatus(jobId, 0, 'pending', 'Job manually requeued.');
  processQueue();
};

export const deleteJob = async (jobId) => {
  await dbRun('DELETE FROM download_job_logs WHERE job_id = ?', [jobId]);
  const result = await dbRun("DELETE FROM download_jobs WHERE id = ? AND status != 'downloading'", [jobId]);
  if (result.changes === 0) {
    throw new ApiError(409, 'JOB_ACTIVE', 'Active jobs must be cancelled before deletion');
  }
};

export const clearCompletedJobs = async () => {
  await dbRun(`DELETE FROM download_job_logs WHERE job_id IN (SELECT id FROM download_jobs WHERE status IN ('completed', 'cancelled'))`);
  return dbRun("DELETE FROM download_jobs WHERE status IN ('completed', 'cancelled')");
};

// Main loop runner for the queue
export const processQueue = async () => {
  if (isProcessing || isPaused) return;
  isProcessing = true;

  try {
    while (true) {
      if (isPaused) break;
      // Fetch the next pending job
      const job = await dbGet(
        `SELECT * FROM download_jobs
         WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY id ASC LIMIT 1`,
        [new Date().toISOString()]
      );

      if (!job) {
        break; // No more pending jobs
      }

      logger.info('queue processing job', { job_id: job.id, url: job.url, type: job.type });
      await dbRun('UPDATE download_jobs SET attempt_count = COALESCE(attempt_count, 0) + 1 WHERE id = ?', [job.id]);
      const freshJob = await dbGet('SELECT * FROM download_jobs WHERE id = ?', [job.id]);
      await updateJobStatus(job.id, 0, 'downloading', `Started ${jobTypeLabel(job.type)} job.`);

      try {
        const processOptions = {
          onProcess: (proc) => activeProcesses.set(job.id, proc)
        };

        if (job.type === 'channel') {
          // CHANNEL SCAN JOB
          await updateJobStatus(job.id, 10, 'downloading', 'Scanning profile for posts...');
          const entries = await scanProfile(job.url, processOptions);
          const username = requireTikTokUsername(job.url);

          await updateJobStatus(job.id, 50, 'downloading', `Found ${entries.length} posts. Checking for new downloads...`);
          
          let newPostsCount = 0;
          for (const entry of entries) {
            const postId = entry.id;
            if (!postId) continue;

            // Check database to see if we already downloaded this post
            const postExists = await dbGet('SELECT id FROM posts WHERE id = ?', [postId]);
            if (!postExists) {
              const postUrl = entry.url || `https://www.tiktok.com/@${username.replace(/^@/, '')}/video/${postId}`;
              // Queue the individual post for download
              await dbRun(
                `INSERT OR IGNORE INTO download_jobs (url, type, status, created_at) VALUES (?, ?, ?, ?)`,
                [postUrl, 'post', 'pending', new Date().toISOString()]
              );
              newPostsCount++;
            }
          }

          const latest = await dbGet('SELECT status FROM download_jobs WHERE id = ?', [job.id]);
          if (latest?.status === 'cancelled') continue;

          await updateJobStatus(
            job.id, 
            100, 
            'completed', 
            `Scan complete. Found ${entries.length} total posts. Added ${newPostsCount} new posts to the download queue.`
          );

        } else if (job.type === 'post' || job.type === 'gallery-dl') {
          // SINGLE POST DOWNLOAD JOB
          const downloader = job.type === 'gallery-dl' ? downloadWithGalleryDl : downloadPost;
          await downloader(job.url, async (progress, statusText) => {
            await updateJobStatus(job.id, progress, 'downloading', statusText);
          }, processOptions);
          const latest = await dbGet('SELECT status FROM download_jobs WHERE id = ?', [job.id]);
          if (latest?.status === 'cancelled') continue;
          await updateJobStatus(job.id, 100, 'completed');
        } else {
          throw new ApiError(400, 'INVALID_JOB_TYPE', `Unsupported job type: ${job.type}`);
        }
      } catch (err) {
        const latest = await dbGet('SELECT * FROM download_jobs WHERE id = ?', [job.id]);
        if (latest?.status === 'cancelled') {
          logger.info('queue job cancelled', { job_id: job.id });
          continue;
        }

        const errorClass = classifyError(err);
        const attemptCount = freshJob.attempt_count || 1;
        const maxAttempts = freshJob.max_attempts || 3;
        logger.error('queue job failed', { job_id: job.id, error: err, error_class: errorClass, attempt_count: attemptCount });

        if (isRetryable(errorClass) && attemptCount < maxAttempts) {
          const retryAt = nextBackoffDate(attemptCount);
          await dbRun(
            `UPDATE download_jobs
             SET status = 'pending', progress = 0, error_message = ?, next_attempt_at = ?,
                 last_error_class = ?, log_output = substr(log_output || ?, -?)
             WHERE id = ?`,
            [
              err.message || 'Unknown error occurred.',
              retryAt,
              errorClass,
              `[${new Date().toISOString()}] ERROR: ${err.message || 'Unknown error occurred.'}\nRetrying at ${retryAt}.\n`,
              LOG_CAP,
              job.id
            ]
          );
          await dbRun(
            'INSERT INTO download_job_logs (job_id, created_at, level, message) VALUES (?, ?, ?, ?)',
            [job.id, new Date().toISOString(), 'warn', `Retry scheduled at ${retryAt} after ${errorClass} failure.`]
          );
        } else {
          await dbRun('UPDATE download_jobs SET last_error_class = ? WHERE id = ?', [errorClass, job.id]);
          await updateJobStatus(job.id, 0, 'failed', '', err.message || 'Unknown error occurred.');
        }
      } finally {
        activeProcesses.delete(job.id);
      }
    }
  } catch (err) {
    logger.error('queue main loop failed', { error: err });
  } finally {
    isProcessing = false;
    if (!isPaused) {
      const dueJob = await dbGet(
        `SELECT id FROM download_jobs WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) LIMIT 1`,
        [new Date().toISOString()]
      );
      if (dueJob) processQueue();
    }
  }
};
