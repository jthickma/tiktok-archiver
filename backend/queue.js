/**
 * Queue module — thin facade over job-service for backward compatibility.
 * All existing public API signatures are preserved.
 */
import { dbRun, dbGet, dbAll } from './database.js';
import * as jobService from './services/job-service.js';

// Re-export with original function names for backward compatibility
export const enqueue = async (url, type, options = {}) =>
  jobService.enqueue(dbRun, dbGet, dbAll, url, type, options);

export const recoverInterruptedJobs = async () =>
  jobService.recoverInterrupted(dbAll, dbRun);

export const pauseQueue = () => jobService.pause();

export const resumeQueue = () => jobService.resume(dbRun, dbGet);

export const getQueueState = () => jobService.getState();

export const readQueueSummary = async () => jobService.readSummary(dbAll);

export const listQueueJobs = async (filters) => jobService.list(dbAll, filters);

export const readJobLogs = async (jobId) =>
  jobService.getLogs(dbAll, dbGet, jobId);

export const cancelJob = async (jobId) =>
  jobService.cancel(dbGet, dbRun, jobId);

export const retryJob = async (jobId) => jobService.retry(dbGet, dbRun, jobId);

export const deleteJob = async (jobId) => jobService.remove(dbRun, jobId);

export const clearCompletedJobs = async () => jobService.clearCompleted(dbRun);

export const processQueue = async () =>
  jobService.processQueue(dbRun, dbGet, dbAll);
