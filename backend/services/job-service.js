/**
 * Job service — orchestrates queue processing, decoupled from Express and DB directly.
 * This extracts the processQueue logic from queue.js into a testable service.
 */
import { logger } from '../logger.js';
import { ApiError } from '../validation.js';
import {
  enqueueJob,
  updateJobStatus,
  getNextPendingJob,
  getJobById,
  getJobLogs as repoGetJobLogs,
  cancelJob as repoCancelJob,
  retryJob as repoRetryJob,
  deleteJob as repoDeleteJob,
  clearCompletedJobs as repoClearCompletedJobs,
  recoverInterruptedJobs as repoRecoverInterruptedJobs,
  getQueueSummary,
  listJobs,
  getDueJob,
  incrementAttempt,
  scheduleRetry,
  markJobFailed,
  classifyError,
  isRetryable,
} from '../repositories/job-repository.js';
import { getPostById } from '../repositories/post-repository.js';
import {
  scanProfile,
  requireTikTokUsername,
  downloadPost,
  downloadWithGalleryDl,
} from '../downloader.js';

let isProcessing = false;
let isPaused = false;
const activeProcesses = new Map();

const jobTypeLabel = (type) => {
  if (type === 'channel') return 'profile scan';
  if (type === 'gallery-dl') return 'gallery-dl download';
  return 'download';
};

/**
 * Enqueue a new download job.
 */
export const enqueue = async (
  dbRun,
  dbGet,
  _dbAll,
  url,
  type,
  options = {},
) => {
  try {
    const result = await enqueueJob(dbRun, dbGet, url, type, options);
    // Trigger queue processing (fire-and-forget)
    processQueue(dbRun, dbGet);
    return result;
  } catch (err) {
    logger.error('failed to enqueue job', { error: err, url, type });
    throw err;
  }
};

/**
 * Recover jobs interrupted by a server restart.
 */
export const recoverInterrupted = async (dbAll, dbRun) =>
  repoRecoverInterruptedJobs(dbAll, dbRun);

export const pause = () => {
  isPaused = true;
  logger.info('queue paused');
};

export const resume = (dbRun, dbGet) => {
  isPaused = false;
  logger.info('queue resumed');
  processQueue(dbRun, dbGet);
};

export const getState = () => ({
  isProcessing,
  isPaused,
  activeJobIds: Array.from(activeProcesses.keys()),
});

export const readSummary = async (dbAll) => getQueueSummary(dbAll);

export const list = async (dbAll, { status, type } = {}) => {
  const result = await listJobs(dbAll, { status, type });
  return {
    ...result,
    state: getState(),
    summary: await readSummary(dbAll),
  };
};

export const getLogs = async (dbAll, dbGet, jobId) => {
  try {
    return await repoGetJobLogs(dbAll, dbGet, jobId);
  } catch (err) {
    if (err.code === 'NOT_FOUND')
      throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    throw err;
  }
};

export const cancel = async (dbGet, dbRun, jobId) => {
  let job;
  try {
    job = await repoCancelJob(dbGet, dbRun, jobId);
  } catch (err) {
    if (err.code === 'NOT_FOUND')
      throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    if (err.code === 'JOB_NOT_ACTIVE')
      throw new ApiError(409, 'JOB_NOT_ACTIVE', 'Job is already finished');
    throw err;
  }

  const proc = activeProcesses.get(jobId);
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 5000);
  }

  await updateJobStatus(
    dbRun,
    jobId,
    job.progress || 0,
    'cancelled',
    'Cancelled by user',
  );
};

export const retry = async (dbGet, dbRun, jobId) => {
  const job = await getJobById(dbGet, jobId);
  if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
  await repoRetryJob(dbRun, jobId);
  await updateJobStatus(dbRun, jobId, 0, 'pending', 'Job manually requeued.');
  processQueue(dbRun, dbGet);
};

export const remove = async (dbRun, jobId) => {
  const changes = await repoDeleteJob(dbRun, jobId);
  if (changes === 0) {
    throw new ApiError(
      409,
      'JOB_ACTIVE',
      'Active jobs must be cancelled before deletion',
    );
  }
};

export const clearCompleted = async (dbRun) => repoClearCompletedJobs(dbRun);

/**
 * Main queue processing loop — extracted from queue.js
 */
export const processQueue = async (dbRun, dbGet, dbAll) => {
  if (isProcessing || isPaused) return;
  isProcessing = true;

  try {
    while (true) {
      if (isPaused) break;
      const job = await getNextPendingJob(dbGet);
      if (!job) break;

      logger.info('queue processing job', {
        job_id: job.id,
        url: job.url,
        type: job.type,
      });
      await incrementAttempt(dbRun, job.id);
      const freshJob = await getJobById(dbGet, job.id);
      await updateJobStatus(
        dbRun,
        job.id,
        0,
        'downloading',
        `Started ${jobTypeLabel(job.type)} job.`,
      );

      try {
        const processOptions = {
          onProcess: (proc) => activeProcesses.set(job.id, proc),
        };

        if (job.type === 'channel') {
          await updateJobStatus(
            dbRun,
            job.id,
            10,
            'downloading',
            'Scanning profile for posts...',
          );
          const entries = await scanProfile(job.url, processOptions);
          const username = requireTikTokUsername(job.url);
          await updateJobStatus(
            dbRun,
            job.id,
            50,
            'downloading',
            `Found ${entries.length} posts. Checking for new downloads...`,
          );

          let newPostsCount = 0;
          for (const entry of entries) {
            const postId = entry.id;
            if (!postId) continue;
            const postExists = await getPostById(dbGet, postId);
            if (!postExists) {
              const postUrl =
                entry.url ||
                `https://www.tiktok.com/@${username.replace(/^@/, '')}/video/${postId}`;
              await enqueueJob(dbRun, dbGet, postUrl, 'post');
              newPostsCount++;
            }
          }

          const latest = await getJobById(dbGet, job.id);
          if (latest?.status === 'cancelled') continue;
          await updateJobStatus(
            dbRun,
            job.id,
            100,
            'completed',
            `Scan complete. Found ${entries.length} total posts. Added ${newPostsCount} new posts.`,
          );
        } else if (job.type === 'post' || job.type === 'gallery-dl') {
          const downloader =
            job.type === 'gallery-dl' ? downloadWithGalleryDl : downloadPost;
          await downloader(
            job.url,
            async (progress, statusText) => {
              await updateJobStatus(
                dbRun,
                job.id,
                progress,
                'downloading',
                statusText,
              );
            },
            processOptions,
          );
          const latest = await getJobById(dbGet, job.id);
          if (latest?.status === 'cancelled') continue;
          await updateJobStatus(dbRun, job.id, 100, 'completed');
        } else {
          throw new ApiError(
            400,
            'INVALID_JOB_TYPE',
            `Unsupported job type: ${job.type}`,
          );
        }
      } catch (err) {
        const latest = await getJobById(dbGet, job.id);
        if (latest?.status === 'cancelled') {
          logger.info('queue job cancelled', { job_id: job.id });
          continue;
        }

        const errorClass = classifyError(err);
        const attemptCount = freshJob.attempt_count || 1;
        const maxAttempts = freshJob.max_attempts || 3;
        logger.error('queue job failed', {
          job_id: job.id,
          error: err,
          error_class: errorClass,
          attempt_count: attemptCount,
        });

        if (isRetryable(errorClass) && attemptCount < maxAttempts) {
          await scheduleRetry(
            dbRun,
            job.id,
            err.message || 'Unknown error occurred.',
            errorClass,
            attemptCount,
          );
        } else {
          await markJobFailed(dbRun, job.id, errorClass, err.message);
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
      const dueJob = await getDueJob(dbGet);
      if (dueJob) processQueue(dbRun, dbGet, dbAll);
    }
  }
};
