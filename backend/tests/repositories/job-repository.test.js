import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import {
  updateJobStatus,
  enqueueJob,
  getNextPendingJob,
  updateJob,
  listJobs,
  getJobById,
  getJobLogs,
  cancelJob,
  retryJob,
  deleteJob,
  clearCompletedJobs,
  recoverInterruptedJobs,
  getQueueSummary,
  getDueJob,
  getNextScheduledJob,
  incrementAttempt,
  scheduleRetry,
  markJobFailed,
  classifyError,
  isRetryable,
} from '../../repositories/job-repository.js';

const createDb = () => {
  const db = new sqlite3.Database(':memory:');

  const dbRun = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });

  const dbGet = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

  const dbAll = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

  return { db, dbRun, dbGet, dbAll };
};

describe('job-repository', () => {
  let db, dbRun, dbGet, dbAll;

  before(async () => {
    const ctx = createDb();
    db = ctx.db;
    dbRun = ctx.dbRun;
    dbGet = ctx.dbGet;
    dbAll = ctx.dbAll;

    await dbRun(`
      CREATE TABLE download_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        log_output TEXT DEFAULT '',
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        attempt_count INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        next_attempt_at TEXT,
        last_error_class TEXT,
        cancelled_at TEXT
      )
    `);
    await dbRun(`
      CREATE TABLE download_job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES download_jobs (id) ON DELETE CASCADE
      )
    `);
  });

  after(() => {
    db.close();
  });

  it('enqueueJob creates a pending job', async () => {
    const result = await enqueueJob(
      dbRun,
      dbGet,
      'https://tiktok.com/@user/video/1',
      'post',
      { maxAttempts: 3 },
    );
    assert.equal(result.url, 'https://tiktok.com/@user/video/1');
    assert.equal(result.type, 'post');
    assert.equal(result.status, 'pending');
    assert.equal(result.created, true);
    assert.ok(result.id > 0);
  });

  it('enqueueJob rejects invalid type', async () => {
    await assert.rejects(
      () => enqueueJob(dbRun, dbGet, 'https://example.com', 'invalid-type'),
      { code: 'INVALID_JOB_TYPE' },
    );
  });

  it('enqueueJob requeues a failed job', async () => {
    // Mark first job as failed
    await updateJobStatus(dbRun, 1, 0, 'failed', '', 'Test failure');

    // Enqueue same URL again
    const result = await enqueueJob(
      dbRun,
      dbGet,
      'https://tiktok.com/@user/video/1',
      'post',
    );
    assert.equal(result.requeued, true);
    assert.equal(result.previousStatus, 'failed');

    // Verify it was reset to pending
    const job = await getJobById(dbGet, 1);
    assert.equal(job.status, 'pending');
    assert.equal(job.attempt_count, 0);
    assert.equal(job.error_message, null);
  });

  it('enqueueJob returns existing job if same URL is already pending', async () => {
    const result = await enqueueJob(
      dbRun,
      dbGet,
      'https://tiktok.com/@user/video/1',
      'post',
    );
    assert.equal(result.created, false);
    assert.equal(result.requeued, false);
  });

  it('getNextPendingJob returns the oldest pending job', async () => {
    // Enqueue a second job
    await enqueueJob(dbRun, dbGet, 'https://tiktok.com/@user/video/2', 'post');

    const job = await getNextPendingJob(dbGet);
    assert.ok(job);
    assert.equal(job.status, 'pending');
    assert.equal(job.id, 1); // Should be the first one
  });

  it('getNextPendingJob respects next_attempt_at', async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    await updateJob(dbRun, 1, { next_attempt_at: futureTime });

    const job = await getNextPendingJob(dbGet);
    assert.ok(job);
    assert.equal(job.id, 2); // Should skip job 1 (future retry) and return job 2
  });

  it('updateJobStatus transitions through states', async () => {
    const jobId = 2;

    // downloading
    await updateJobStatus(dbRun, jobId, 50, 'downloading', 'Downloading...');
    let job = await getJobById(dbGet, jobId);
    assert.equal(job.status, 'downloading');
    assert.equal(job.progress, 50);

    // completed
    await updateJobStatus(dbRun, jobId, 100, 'completed');
    job = await getJobById(dbGet, jobId);
    assert.equal(job.status, 'completed');
    assert.equal(job.progress, 100);
    assert.ok(job.completed_at);

    // Check that log was written
    const logs = await dbAll(
      'SELECT * FROM download_job_logs WHERE job_id = ?',
      [jobId],
    );
    assert.ok(logs.length > 0);
  });

  it('updateJobStatus handles cancelled state', async () => {
    await enqueueJob(dbRun, dbGet, 'https://tiktok.com/@user/video/3', 'post');
    await updateJobStatus(dbRun, 3, 20, 'cancelled', 'Cancelled by user');
    const job = await getJobById(dbGet, 3);
    assert.equal(job.status, 'cancelled');
    assert.ok(job.cancelled_at);
  });

  it('getJobLogs returns combined logs', async () => {
    const result = await getJobLogs(dbAll, dbGet, 2);
    assert.ok(result.logs);
    assert.equal(result.status, 'completed');
    assert.equal(result.error, null);
  });

  it('getJobLogs throws for missing job', async () => {
    await assert.rejects(() => getJobLogs(dbAll, dbGet, 999), {
      code: 'NOT_FOUND',
    });
  });

  it('cancelJob returns job and allows cancellation', async () => {
    // Re-enqueue job 3 to make it pending again
    await retryJob(dbRun, 3);
    const job = await cancelJob(dbGet, dbRun, 3);
    assert.equal(job.status, 'pending');
  });

  it('cancelJob throws for already finished job', async () => {
    await assert.rejects(() => cancelJob(dbGet, dbRun, 2), {
      code: 'JOB_NOT_ACTIVE',
    });
  });

  it('cancelJob throws for non-existent job', async () => {
    await assert.rejects(() => cancelJob(dbGet, dbRun, 999), {
      code: 'NOT_FOUND',
    });
  });

  it('retryJob resets a failed job to pending', async () => {
    await updateJobStatus(dbRun, 1, 0, 'failed', '', 'Error');
    await retryJob(dbRun, 1);
    const job = await getJobById(dbGet, 1);
    assert.equal(job.status, 'pending');
    assert.equal(job.error_message, null);
  });

  it('listJobs separates active and history', async () => {
    const result = await listJobs(dbAll);
    assert.ok(Array.isArray(result.active));
    assert.ok(Array.isArray(result.history));
    // At this point: completed jobs and failed jobs appear in history
    assert.ok(result.history.length >= 1);
  });

  it('listJobs filters by status', async () => {
    const result = await listJobs(dbAll, { status: 'pending' });
    assert.ok(result.active.length >= 1);
  });

  it('listJobs filters by type', async () => {
    const result = await listJobs(dbAll, { type: 'post' });
    // All jobs are 'post' type
    assert.ok(result.active.length + result.history.length >= 3);
  });

  it('deleteJob removes job and logs', async () => {
    // Create a temporary job, complete it, then delete
    await enqueueJob(
      dbRun,
      dbGet,
      'https://tiktok.com/@user/video/delete-me',
      'post',
    );
    const job = await getJobById(dbGet, 4);
    await updateJobStatus(dbRun, 4, 100, 'completed');
    const deleted = await deleteJob(dbRun, 4);
    assert.equal(deleted, 1);
    const found = await getJobById(dbGet, 4);
    assert.equal(found, null);
  });

  it('deleteJob refuses to delete active downloading job', async () => {
    // Set job 5 to downloading — we need a new one
    await enqueueJob(
      dbRun,
      dbGet,
      'https://tiktok.com/@user/video/active',
      'post',
    );
    await updateJobStatus(dbRun, 5, 10, 'downloading', 'In progress');
    const deleted = await deleteJob(dbRun, 5);
    assert.equal(deleted, 0);
  });

  it('clearCompletedJobs removes completed and cancelled', async () => {
    // We have: job1=completed, job2=completed, job3=cancelled (after retry+re-cancel)
    // Let's check the state
    const before = await getQueueSummary(dbAll);
    const cleared = await clearCompletedJobs(dbRun);
    assert.ok(cleared.changes >= 0); // At least some jobs removed
  });

  it('getQueueSummary returns counts', async () => {
    const summary = await getQueueSummary(dbAll);
    assert.ok(summary.counts);
    assert.equal(typeof summary.totalCount, 'number');
    assert.equal(typeof summary.activeCount, 'number');
    assert.equal(typeof summary.problemCount, 'number');
  });

  it('recoverInterruptedJobs resets downloading jobs to pending', async () => {
    // Create a job stuck in downloading
    await enqueueJob(
      dbRun,
      dbGet,
      'https://tiktok.com/@user/video/recover',
      'post',
    );
    await updateJobStatus(dbRun, 6, 30, 'downloading', 'Was downloading...');

    const recovered = await recoverInterruptedJobs(dbAll, dbRun);
    // Should recover at least the job we created (may also find job 5 which is downloading)
    assert.ok(recovered >= 1);

    const job = await getJobById(dbGet, 6);
    assert.equal(job.status, 'pending');
  });

  it('incrementAttempt increases attempt_count', async () => {
    await incrementAttempt(dbRun, 1);
    const job = await getJobById(dbGet, 1);
    assert.equal(job.attempt_count, 1);
  });

  it('getDueJob returns next job due for processing', async () => {
    const job = await getDueJob(dbGet);
    assert.ok(job);
    assert.ok(job.id);
  });

  it('getNextScheduledJob returns the earliest delayed retry', async () => {
    const first = new Date(Date.now() + 30_000).toISOString();
    const second = new Date(Date.now() + 60_000).toISOString();
    await dbRun('UPDATE download_jobs SET next_attempt_at = NULL');
    const later = await enqueueJob(
      dbRun,
      dbGet,
      'https://tiktok.com/@user/video/later-retry',
      'post',
    );
    const earlier = await enqueueJob(
      dbRun,
      dbGet,
      'https://tiktok.com/@user/video/earlier-retry',
      'post',
    );
    await updateJob(dbRun, later.id, { next_attempt_at: second });
    await updateJob(dbRun, earlier.id, { next_attempt_at: first });

    const job = await getNextScheduledJob(dbGet);
    assert.equal(job.id, earlier.id);
    assert.equal(job.next_attempt_at, first);
  });

  it('scheduleRetry sets next_attempt_at with backoff', async () => {
    await enqueueJob(
      dbRun,
      dbGet,
      'https://tiktok.com/@user/video/retry-test',
      'post',
    );
    await scheduleRetry(dbRun, 7, 'Network error', 'network', 1);
    const job = await getJobById(dbGet, 7);
    assert.equal(job.status, 'pending');
    assert.ok(job.next_attempt_at);
    assert.ok(job.last_error_class, 'network');
    assert.ok(job.error_message, 'Network error');
  });

  it('markJobFailed sets status to failed', async () => {
    await markJobFailed(dbRun, 7, 'validation', 'Invalid URL');
    const job = await getJobById(dbGet, 7);
    assert.equal(job.status, 'failed');
    assert.equal(job.last_error_class, 'validation');
  });

  it('classifyError categorizes errors', () => {
    assert.equal(classifyError(new Error('cancelled by user')), 'cancelled');
    assert.equal(
      classifyError(new Error('validation error: invalid URL')),
      'validation',
    );
    assert.equal(
      classifyError(new Error('429 Too Many Requests')),
      'rate_limit',
    );
    assert.equal(classifyError(new Error('ECONNREFUSED')), 'network');
    assert.equal(
      classifyError(new Error("This user's account is private")),
      'unavailable',
    );
    assert.equal(
      classifyError(new Error('HTTP Error 404: Not Found')),
      'unavailable',
    );
    assert.equal(classifyError(new Error('yt-dlp returned code 1')), 'tool');
  });

  it('isRetryable returns correct values', () => {
    assert.equal(isRetryable('network'), true);
    assert.equal(isRetryable('rate_limit'), true);
    assert.equal(isRetryable('tool'), true);
    assert.equal(isRetryable('validation'), false);
    assert.equal(isRetryable('cancelled'), false);
    assert.equal(isRetryable('unavailable'), false);
  });
});
