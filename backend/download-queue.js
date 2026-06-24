import { logger } from './logger.js';
import { ApiError } from './validation.js';
import { requireTikTokUsername } from './identity.js';
import * as jobs from './repositories/job-repository.js';

/**
 * Deep download queue module.
 *
 * Owns queue state, scheduling, persistence orchestration, retries, process
 * cancellation, and acquisition dispatch. HTTP routes and profile monitoring
 * use this interface without seeing database helpers or child processes.
 */
export const createDownloadQueue = ({ database, acquisition }) => {
  const { run, get, all } = database;
  let isProcessing = false;
  let isPaused = false;
  let retryTimer = null;
  const activeProcesses = new Map();

  const state = () => ({
    isProcessing,
    isPaused,
    activeJobIds: Array.from(activeProcesses.keys()),
  });

  const clearRetryTimer = () => {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  const jobTypeLabel = (type) => {
    if (type === 'channel') return 'profile scan';
    if (type === 'gallery-dl') return 'gallery-dl download';
    return 'download';
  };

  const scheduleNextRun = async () => {
    clearRetryTimer();
    const nextJob = await jobs.getNextScheduledJob(get);
    if (!nextJob?.next_attempt_at) return;
    const delay = Math.max(
      0,
      new Date(nextJob.next_attempt_at).getTime() - Date.now(),
    );
    retryTimer = setTimeout(() => {
      retryTimer = null;
      process();
    }, Math.min(delay, 2_147_483_647));
    retryTimer.unref?.();
  };

  const enqueue = async (url, type, options = {}) => {
    try {
      const result = await jobs.enqueueJob(run, get, url, type, options);
      void process();
      return result;
    } catch (error) {
      logger.error('failed to enqueue job', { error, url, type });
      throw error;
    }
  };

  const recoverInterrupted = () => jobs.recoverInterruptedJobs(all, run);

  const pause = () => {
    isPaused = true;
    logger.info('queue paused');
  };

  const resume = () => {
    isPaused = false;
    logger.info('queue resumed');
    void process();
  };

  const summary = () => jobs.getQueueSummary(all);

  const list = async (filters = {}) => ({
    ...(await jobs.listJobs(all, filters)),
    state: state(),
    summary: await summary(),
  });

  const logs = async (jobId) => {
    try {
      return await jobs.getJobLogs(all, get, jobId);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        throw new ApiError(404, 'NOT_FOUND', 'Job not found');
      }
      throw error;
    }
  };

  const cancel = async (jobId) => {
    let job;
    try {
      job = await jobs.cancelJob(get, run, jobId);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        throw new ApiError(404, 'NOT_FOUND', 'Job not found');
      }
      if (error.code === 'JOB_NOT_ACTIVE') {
        throw new ApiError(409, 'JOB_NOT_ACTIVE', 'Job is already finished');
      }
      throw error;
    }

    const proc = activeProcesses.get(jobId);
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5000).unref?.();
    }
    await jobs.updateJobStatus(
      run,
      jobId,
      job.progress || 0,
      'cancelled',
      'Cancelled by user',
    );
  };

  const retry = async (jobId) => {
    const job = await jobs.getJobById(get, jobId);
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    await jobs.retryJob(run, jobId);
    await jobs.updateJobStatus(
      run,
      jobId,
      0,
      'pending',
      'Job manually requeued.',
    );
    void process();
  };

  const remove = async (jobId) => {
    const changes = await jobs.deleteJob(run, jobId);
    if (changes === 0) {
      throw new ApiError(
        409,
        'JOB_ACTIVE',
        'Active jobs must be cancelled before deletion',
      );
    }
  };

  const clearCompleted = () => jobs.clearCompletedJobs(run);

  const processChannel = async (job) => {
    await jobs.updateJobStatus(
      run,
      job.id,
      10,
      'downloading',
      'Scanning profile for posts...',
    );
    const entries = await acquisition.scanProfile(job.url, {
      onProcess: (proc) => activeProcesses.set(job.id, proc),
    });
    const username = requireTikTokUsername(job.url);
    await jobs.updateJobStatus(
      run,
      job.id,
      50,
      'downloading',
      `Found ${entries.length} posts. Checking for new downloads...`,
    );

    let newPostsCount = 0;
    for (const entry of entries) {
      if (!entry.id) continue;
      const postExists = await get('SELECT id FROM posts WHERE id = ?', [
        entry.id,
      ]);
      if (postExists) continue;
      const postUrl =
        entry.url ||
        `https://www.tiktok.com/@${username.replace(/^@/, '')}/video/${entry.id}`;
      const queued = await jobs.enqueueJob(run, get, postUrl, 'post');
      if (queued.created || queued.requeued) newPostsCount += 1;
    }

    const latest = await jobs.getJobById(get, job.id);
    if (latest?.status === 'cancelled') return;
    await jobs.updateJobStatus(
      run,
      job.id,
      100,
      'completed',
      `Scan complete. Found ${entries.length} total posts. Added ${newPostsCount} new posts.`,
    );
  };

  const processMedia = async (job) => {
    const download =
      job.type === 'gallery-dl'
        ? acquisition.downloadGallery
        : acquisition.downloadPost;
    await download(
      job.url,
      (progress, statusText) =>
        jobs.updateJobStatus(
          run,
          job.id,
          progress,
          'downloading',
          statusText,
        ),
      { onProcess: (proc) => activeProcesses.set(job.id, proc) },
    );
    const latest = await jobs.getJobById(get, job.id);
    if (latest?.status !== 'cancelled') {
      await jobs.updateJobStatus(run, job.id, 100, 'completed');
    }
  };

  const processJob = async (job) => {
    if (job.type === 'channel') return processChannel(job);
    if (job.type === 'post' || job.type === 'gallery-dl') {
      return processMedia(job);
    }
    throw new ApiError(
      400,
      'INVALID_JOB_TYPE',
      `Unsupported job type: ${job.type}`,
    );
  };

  async function process() {
    if (isProcessing || isPaused) return;
    clearRetryTimer();
    isProcessing = true;

    try {
      while (!isPaused) {
        const job = await jobs.getNextPendingJob(get);
        if (!job) break;
        logger.info('queue processing job', {
          job_id: job.id,
          url: job.url,
          type: job.type,
        });
        await jobs.incrementAttempt(run, job.id);
        const freshJob = await jobs.getJobById(get, job.id);
        await jobs.updateJobStatus(
          run,
          job.id,
          0,
          'downloading',
          `Started ${jobTypeLabel(job.type)} job.`,
        );

        try {
          await processJob(job);
        } catch (error) {
          const latest = await jobs.getJobById(get, job.id);
          if (latest?.status === 'cancelled') {
            logger.info('queue job cancelled', { job_id: job.id });
            continue;
          }
          const errorClass = jobs.classifyError(error);
          const attemptCount = freshJob.attempt_count || 1;
          const maxAttempts = freshJob.max_attempts || 3;
          logger.error('queue job failed', {
            job_id: job.id,
            error,
            error_class: errorClass,
            attempt_count: attemptCount,
          });
          if (jobs.isRetryable(errorClass) && attemptCount < maxAttempts) {
            await jobs.scheduleRetry(
              run,
              job.id,
              error.message || 'Unknown error occurred.',
              errorClass,
              attemptCount,
            );
          } else {
            await jobs.markJobFailed(
              run,
              job.id,
              errorClass,
              error.message,
            );
          }
        } finally {
          activeProcesses.delete(job.id);
        }
      }
    } catch (error) {
      logger.error('queue main loop failed', { error });
    } finally {
      isProcessing = false;
      if (!isPaused) {
        if (await jobs.getDueJob(get)) {
          void process();
        } else {
          await scheduleNextRun();
        }
      }
    }
  }

  return Object.freeze({
    enqueue,
    recoverInterrupted,
    pause,
    resume,
    state,
    summary,
    list,
    logs,
    cancel,
    retry,
    remove,
    clearCompleted,
    process,
  });
};
