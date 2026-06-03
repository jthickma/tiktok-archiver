import React, { useEffect, useRef, useState } from 'react';

const terminalStatuses = ['failed', 'completed', 'cancelled'];

const formatDate = (isoString) => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
};

const durationLabel = (job) => {
  const start = job.started_at || job.created_at;
  const end = job.completed_at || new Date().toISOString();
  if (!start) return 'Unknown';
  const seconds = Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const readableUrl = (value) => {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'tiktok.com') {
      const handle = parts.find((part) => part.startsWith('@'));
      const videoIndex = parts.indexOf('video');
      if (handle && videoIndex >= 0 && parts[videoIndex + 1]) return `${handle} / ${parts[videoIndex + 1]}`;
      if (handle) return handle;
    }
    return `${host}${url.pathname === '/' ? '' : url.pathname}`.replace(/\/$/, '');
  } catch {
    return value;
  }
};

const jobStatusTone = (status) => {
  if (status === 'downloading') return 'info';
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  return 'muted';
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
          <span className={`job-type-badge ${job.type}`}>{job.type === 'post' ? 'download' : 'profile scan'}</span>
          <span>{progress}%</span>
          <span>{durationLabel(job)}</span>
          <span>try {job.attempt_count || 0}/{job.max_attempts || 3}</span>
        </span>
        <span className="progress-bar-wrapper" aria-hidden="true">
          <span className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </span>
        {job.next_attempt_at && <span className="retry-note">Retry {formatDate(job.next_attempt_at)}</span>}
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

export default function LogQueue({ onQueueChanged }) {
  const [activeJobs, setActiveJobs] = useState([]);
  const [historyJobs, setHistoryJobs] = useState([]);
  const [state, setState] = useState({ isPaused: false });
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLogs, setJobLogs] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [summary, setSummary] = useState({ counts: {} });
  const [actionError, setActionError] = useState('');
  const terminalRef = useRef(null);

  const fetchQueue = async () => {
    const params = new URLSearchParams({ status: statusFilter, type: typeFilter });
    const res = await fetch(`/api/queue?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to load queue');
    setActiveJobs(data.active || []);
    setHistoryJobs(data.history || []);
    setState(data.state || {});
    setSummary(data.summary || { counts: {} });
    if (selectedJob) {
      const latest = [...(data.active || []), ...(data.history || [])].find((job) => job.id === selectedJob.id);
      if (latest) setSelectedJob(latest);
    }
  };

  const fetchLogs = async (jobId) => {
    const res = await fetch(`/api/queue/${jobId}/logs`);
    const data = await res.json();
    setJobLogs(data.logs || 'No log output yet.');
  };

  const runAction = async (path, method = 'POST') => {
    const res = await fetch(path, { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || 'Queue action failed');
    setActionError('');
    await fetchQueue();
    onQueueChanged?.();
  };

  const handleAction = (path, method = 'POST') => {
    runAction(path, method).catch((err) => setActionError(err.message));
  };

  useEffect(() => {
    fetchQueue().catch(console.error);
    const interval = setInterval(() => fetchQueue().catch(console.error), 1500);
    return () => clearInterval(interval);
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    if (!selectedJob) {
      setJobLogs('');
      return undefined;
    }
    fetchLogs(selectedJob.id).catch(console.error);
    const interval = setInterval(() => fetchLogs(selectedJob.id).catch(console.error), 1500);
    return () => clearInterval(interval);
  }, [selectedJob?.id]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [jobLogs]);

  const jobs = [...activeJobs, ...historyJobs];
  const counts = { ...countByStatus(jobs), ...(summary.counts || {}) };
  const activeCount = activeJobs.length;

  return (
    <div className="queue-console">
      {actionError && <div className="alert danger">{actionError}</div>}

      <div className="queue-summary" aria-label="Queue summary">
        {['downloading', 'pending', 'failed', 'completed'].map((status) => (
          <span key={status} className={`queue-summary-chip ${jobStatusTone(status)}`}>
            <strong>{counts[status] || 0}</strong>
            {status}
          </span>
        ))}
      </div>

      <div className="queue-toolbar">
        <div className="segmented-control">
          <button type="button" className={!statusFilter ? 'active' : ''} onClick={() => setStatusFilter('')}>History</button>
          {terminalStatuses.map((status) => (
            <button key={status} type="button" className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>{status}</button>
          ))}
        </div>
        <select className="select-input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">All types</option>
          <option value="channel">Channels</option>
          <option value="post">Downloads</option>
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
            {selectedJob.error_message && <div className="alert danger">{selectedJob.error_message}</div>}
          </aside>
        )}
      </div>
    </div>
  );
}
