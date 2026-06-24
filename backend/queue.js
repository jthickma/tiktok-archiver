/**
 * Compatibility exports for callers that predate the deep queue module.
 */
import { database } from './database.js';
import { acquisition } from './acquisition.js';
import { createDownloadQueue } from './download-queue.js';

export const downloadQueue = createDownloadQueue({ database, acquisition });

export const enqueue = downloadQueue.enqueue;
export const recoverInterruptedJobs = downloadQueue.recoverInterrupted;
export const pauseQueue = downloadQueue.pause;
export const resumeQueue = downloadQueue.resume;
export const getQueueState = downloadQueue.state;
export const readQueueSummary = downloadQueue.summary;
export const listQueueJobs = downloadQueue.list;
export const readJobLogs = downloadQueue.logs;
export const cancelJob = downloadQueue.cancel;
export const retryJob = downloadQueue.retry;
export const deleteJob = downloadQueue.remove;
export const clearCompletedJobs = downloadQueue.clearCompleted;
export const processQueue = downloadQueue.process;
