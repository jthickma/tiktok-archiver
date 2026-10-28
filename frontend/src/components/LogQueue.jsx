import React, { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import SystemOverview from './SystemOverview';
import { usePolling } from '../utils/usePolling';
import { requestJson } from '../utils/api';
import { formatDateTime, formatDurationBetween } from '../utils/format';
import { readableUrl } from '../utils/media';

const terminalStatuses = ['failed', 'completed', 'cancelled'];

const durationLabel = (job) => {
  const start = job.started_at || job.created_at;
  return formatDurationBetween(start, job.completed_at, 'Unknown');
};

const jobStatusTone = (status) => {
  if (status === 'downloading') return 'info';
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  return 'muted';
};

const jobTypeLabel = (type) => {
  if (type === 'channel') return 'profile scan';
  if (type === 'gallery-dl') return 'gallery-dl';
  return 'download';
};

const countByStatus = (jobs) => jobs.reduce((counts, job) => {
  counts[job.status] = (counts[job.status] || 0) + 1;
  return counts;
}, {});

function JobRow({ job, selected, onSelect, onAction }) {
  const canCancel = job.status === 'downloading' || job.status === 'pending';
  const canRetry = job.status === 'failed' || job.status === 'cancelled';
  const canDelete = job.status !== 'downloading';
  const progress = job.progress || 0;

  return (
    <article className={`job-item ${selected ? 'active-selection' : ''}`}>
      <button type="button" className="job-main" onClick={() => onSelect(job)}>
        <span className="job-title-row">
          <strong className="job-url" title={job.url}>{readableUrl(job.url)}</strong>
          <span className={`job-status-badge ${job.status}`}>{job.status}</span>
        </span>
        <span className="job-subline">
          <span className={`job-type-badge ${job.type}`}>{jobTypeLabel(job.type)}</span>
          <span>{progress}%</span>
          <span>{durationLabel(job)}</span>
          <span>try {job.attempt_count || 0}/{job.max_attempts || 3}</span>
        </span>
        <span className="progress-bar-wrapper" aria-hidden="true">
          <span className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </span>
        {job.next_attempt_at && <span className="retry-note">Retry {formatDateTime(job.next_attempt_at)}</span>}
      </button>
      <div className="job-actions">
        {canCancel && (
          <button type="button" className="icon-btn danger" title="Cancel job" onClick={() => onAction(`/api/queue/${job.id}/cancel`)}>
            Cancel
          </button>
        )}
        {canRetry && (
          <button type="button" className="icon-btn" title="Retry job" onClick={() => onAction(`/api/queue/${job.id}/retry`)}>
            Retry
          </button>
        )}
        {canDelete && (
          <button type="button" className="icon-btn" title="Delete entry" onClick={() => onAction(`/api/queue/${job.id}`, 'DELETE')}>
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

export default function LogQueue({ onQueueChanged, status }) {
  const [confirmation, setConfirmation] = useState(null);
  const [activeJobs, setActiveJobs] = useState([]);
  const [historyJobs, setHistoryJobs] = useState([]);
  const [state, setState] = useState({ isPaused: false });
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLogs, setJobLogs] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [summary, setSummary] = useState({ counts: {} });
  const [actionError, setActionError] = useState('');
  const [queueError, setQueueError] = useState('');
  const terminalRef = useRef(null);

  const fetchQueue = useCallback(async (signal) => {
    try {
      const params = new URLSearchParams({ status: statusFilter, type: typeFilter });
      const data = await requestJson(`/api/queue?${params}`, { signal }, 'Failed to load queue');
      if (signal?.aborted) return;
      setActiveJobs(data.active || []);
      setHistoryJobs(data.history || []);
      setState(data.state || {});
      setSummary(data.summary || { counts: {} });
      setQueueError('');
      setSelectedJob((selected) => selected
        ? [...(data.active || []), ...(data.history || [])].find((job) => job.id === selected.id) || null
        : null);
    } catch (error) {
      if (!signal?.aborted) setQueueError(error.message);
    }
  }, [statusFilter, typeFilter]);

  const selectedId = selectedJob?.id;
  const fetchLogs = useCallback(async (signal) => {
    try {
      const data = await requestJson(`/api/queue/${selectedId}/logs`, { signal }, 'Failed to load job logs');
      if (!signal.aborted) setJobLogs(data.logs || 'No log output yet.');
    } catch (error) {
      if (!signal.aborted) setJobLogs(error.message);
    }
  }, [selectedId]);

  const runAction = async (path, method = 'POST') => {
    await requestJson(path, { method }, 'Queue action failed');
    setActionError('');
    if (method === 'DELETE') setSelectedJob(null);
    await fetchQueue();
    onQueueChanged?.();
  };

  const handleAction = (path, method = 'POST') => {
    if (method === 'DELETE' || path.endsWith('/cancel')) {
      const clearing = path.endsWith('/history/completed');
      const cancelling = path.endsWith('/cancel');
      setConfirmation({
        title: clearing ? 'Clear completed history?' : cancelling ? 'Cancel this job?' : 'Delete this history entry?',
        message: clearing ? 'Remove all completed and cancelled job entries and their logs. Archived media will be kept.' : cancelling ? 'Stop this download or remove it from the waiting queue.' : 'Remove this job entry and its logs. Archived media will be kept.',
        label: clearing ? 'Clear completed' : cancelling ? 'Cancel job' : 'Delete entry',
        path,
        method,
      });
      return;
    }
    runAction(path, method).catch((err) => setActionError(err.message));
  };

  usePolling(fetchQueue, activeJobs.length > 0 ? 3000 : 10000);
  usePolling(fetchLogs, selectedJob?.status === 'downloading' || selectedJob?.status === 'pending' ? 3000 : null, Boolean(selectedId));

  useEffect(() => { setJobLogs(''); }, [selectedId]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [jobLogs]);

  const jobs = [...activeJobs, ...historyJobs];
  const counts = { ...countByStatus(jobs), ...(summary.counts || {}) };
  const activeCount = activeJobs.length;

  return (
    <div className="queue-console">
      {confirmation && <ConfirmDialog title={confirmation.title} message={confirmation.message} confirmLabel={confirmation.label} onConfirm={() => runAction(confirmation.path, confirmation.method)} onClose={() => setConfirmation(null)} />}
      <details className="system-details">
        <summary>System details</summary>
        <SystemOverview status={status} />
      </details>
      {queueError && <div className="alert danger" role="alert">{queueError}</div>}
      {actionError && <div className="alert danger" role="alert">{actionError}</div>}

      <div className="queue-summary" aria-label="Queue summary">
        {['downloading', 'pending', 'failed', 'completed'].map((status) => (
          <span key={status} className={`queue-summary-chip ${jobStatusTone(status)}`}>
            <strong>{counts[status] || 0}</strong>
            {({ downloading: 'Downloading', pending: 'Waiting', failed: 'Failed', completed: 'Completed' })[status]}
          </span>
        ))}
      </div>

      <div className="queue-toolbar">
        <div className="segmented-control">
          <button type="button" className={!statusFilter ? 'active' : ''} onClick={() => setStatusFilter('')}>History</button>
          {terminalStatuses.map((status) => (
            <button key={status} type="button" className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>{status[0].toUpperCase() + status.slice(1)}</button>
          ))}
        </div>
        <select className="select-input" aria-label="Activity type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">All types</option>
          <option value="channel">Channels</option>
          <option value="post">Downloads</option>
          <option value="gallery-dl">gallery-dl</option>
        </select>
        <button type="button" className="btn btn-secondary" onClick={() => handleAction(state.isPaused ? '/api/queue/resume' : '/api/queue/pause')}>
          {state.isPaused ? 'Resume queue' : 'Pause queue'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => handleAction('/api/queue/history/completed', 'DELETE')}>
          Clear completed
        </button>
      </div>

      <div className={`queue-layout ${selectedJob ? 'with-console' : ''}`}>
        <div className="queue-stack">
          <section className="queue-section">
            <div className="queue-section-header">
              <h2>Now</h2>
              <span>{activeCount} active</span>
            </div>
            <div className="queue-list">
              {activeJobs.length === 0 ? (
                <div className="empty-state compact">Nothing is running or waiting.</div>
              ) : activeJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  selected={selectedJob?.id === job.id}
                  onSelect={setSelectedJob}
                  onAction={handleAction}
                />
              ))}
            </div>
          </section>

          <section className="queue-section">
            <div className="queue-section-header">
              <h2>Recent</h2>
              <span>{historyJobs.length} shown</span>
            </div>
            <div className="queue-list">
              {historyJobs.length === 0 ? (
                <div className="empty-state compact">No finished jobs match this filter.</div>
              ) : historyJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  selected={selectedJob?.id === job.id}
                  onSelect={setSelectedJob}
                  onAction={handleAction}
                />
              ))}
            </div>
          </section>
        </div>

        {selectedJob && (
          <aside className="console-panel">
            <div className="console-header">
              <div>
                <strong>Job #{selectedJob.id}</strong>
                <span>{selectedJob.status} / {selectedJob.type}</span>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSelectedJob(null)}>Close</button>
            </div>
            <pre ref={terminalRef} className="terminal-panel">{jobLogs}</pre>
            {selectedJob.error_message && <div className="alert danger" role="alert">{selectedJob.error_message}</div>}
          </aside>
        )}
      </div>
    </div>
  );
}
