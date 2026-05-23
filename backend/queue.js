import { dbRun, dbGet, dbAll } from './database.js';
import { downloadPost, scanProfile, extractUsername } from './downloader.js';

let isProcessing = false;

// Append text to a job's log output and update progress
const updateJobStatus = async (jobId, progress, status, statusText = '', errorMsg = null) => {
  const time = new Date().toISOString();
  
  if (status === 'downloading') {
    await dbRun(
      `UPDATE download_jobs 
       SET progress = ?, status = ?, log_output = log_output || ?, started_at = COALESCE(started_at, ?)
       WHERE id = ?`,
      [progress, status, `[${time}] ${statusText}\n`, time, jobId]
    );
  } else if (status === 'completed') {
    await dbRun(
      `UPDATE download_jobs 
       SET progress = 100, status = ?, log_output = log_output || ?, completed_at = ?
       WHERE id = ?`,
      [status, `[${time}] Job completed successfully.\n`, time, jobId]
    );
  } else if (status === 'failed') {
    await dbRun(
      `UPDATE download_jobs 
       SET status = ?, log_output = log_output || ?, error_message = ?, completed_at = ?
       WHERE id = ?`,
      [status, `[${time}] ERROR: ${errorMsg}\n`, errorMsg, time, jobId]
    );
  } else {
    await dbRun(
      `UPDATE download_jobs SET status = ?, progress = ? WHERE id = ?`,
      [status, progress, jobId]
    );
  }
};

// Queue a new URL for downloading
export const enqueue = async (url, type) => {
  const time = new Date().toISOString();
  try {
    await dbRun(
      `INSERT INTO download_jobs (url, type, status, created_at) VALUES (?, ?, ?, ?)`,
      [url, type, 'pending', time]
    );
    // Trigger queue processing
    processQueue();
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      // If job is already present but in completed/failed/pending state, we might reset it if failed,
      // or ignore if completed. Let's see: if it's failed, reset to pending.
      const existingJob = await dbGet('SELECT * FROM download_jobs WHERE url = ?', [url]);
      if (existingJob && (existingJob.status === 'failed' || existingJob.status === 'completed')) {
        await dbRun(
          `UPDATE download_jobs 
           SET status = 'pending', progress = 0, log_output = '', error_message = NULL, created_at = ?, started_at = NULL, completed_at = NULL 
           WHERE id = ?`,
          [time, existingJob.id]
        );
        processQueue();
      }
    } else {
      console.error('[Queue] Failed to enqueue job:', err);
    }
  }
};

// Main loop runner for the queue
export const processQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (true) {
      // Fetch the next pending job
      const job = await dbGet(
        `SELECT * FROM download_jobs WHERE status = 'pending' ORDER BY id ASC LIMIT 1`
      );

      if (!job) {
        break; // No more pending jobs
      }

      console.log(`[Queue] Processing job ${job.id}: ${job.url} (${job.type})`);
      await updateJobStatus(job.id, 0, 'downloading', `Started processing ${job.type} job.`);

      try {
        if (job.type === 'channel') {
          // CHANNEL SCAN JOB
          await updateJobStatus(job.id, 10, 'downloading', 'Scanning profile for posts...');
          const entries = await scanProfile(job.url);
          const username = extractUsername(job.url);

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

          await updateJobStatus(
            job.id, 
            100, 
            'completed', 
            `Scan complete. Found ${entries.length} total posts. Added ${newPostsCount} new posts to the download queue.`
          );

        } else if (job.type === 'post') {
          // SINGLE POST DOWNLOAD JOB
          await downloadPost(job.url, async (progress, statusText) => {
            await updateJobStatus(job.id, progress, 'downloading', statusText);
          });
          await updateJobStatus(job.id, 100, 'completed');
        }
      } catch (err) {
        console.error(`[Queue] Job ${job.id} failed:`, err);
        await updateJobStatus(job.id, 0, 'failed', '', err.message || 'Unknown error occurred.');
      }
    }
  } catch (err) {
    console.error('[Queue] Error in queue main loop:', err);
  } finally {
    isProcessing = false;
  }
};
