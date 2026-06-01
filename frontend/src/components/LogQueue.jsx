import React, { useEffect, useRef, useState } from 'react';

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

export default function LogQueue({ onQueueChanged }) {
  const [activeJobs, setActiveJobs] = useState([]);
  const [historyJobs, setHistoryJobs] = useState([]);
  const [state, setState] = useState({ isPaused: false });
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLogs, setJobLogs] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const terminalRef = useRef(null);

  const fetchQueue = async () => {
    const params = new URLSearchParams({ status: statusFilter, type: typeFilter });
    const res = await fetch(`/api/queue?${params}`);
    const data = await res.json();
    setActiveJobs(data.active || []);
    setHistoryJobs(data.history || []);
    setState(data.state || {});
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
    await fetchQueue();
    onQueueChanged?.();
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

  return (
    <div className="queue-console">
      <div className="queue-toolbar">
        <div className="segmented-control">
          <button type="button" className={!statusFilter ? 'active' : ''} onClick={() => setStatusFilter('')}>All</button>
          {['failed', 'completed', 'cancelled'].map((status) => (
            <button key={status} type="button" className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>{status}</button>
          ))}
        </div>
        <select className="select-input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">All types</option>
          <option value="channel">Channels</option>
          <option value="post">Downloads</option>
        </select>
        <button type="button" className="btn btn-secondary" onClick={() => runAction(state.isPaused ? '/api/queue/resume' : '/api/queue/pause')}>
          {state.isPaused ? 'Resume queue' : 'Pause queue'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => runAction('/api/queue/history/completed', 'DELETE')}>
          Clear completed
        </button>
      </div>

      <div className={`queue-layout ${selectedJob ? 'with-console' : ''}`}>
        <div className="queue-list">
          {jobs.length === 0 ? (
            <div className="empty-state">No queue entries match this filter.</div>
          ) : jobs.map((job) => (
            <article key={job.id} className={`job-item ${selectedJob?.id === job.id ? 'active-selection' : ''}`}>
              <button type="button" className="job-main" onClick={() => setSelectedJob(job)}>
                <span className="job-header">
                  <strong className="job-url" title={job.url}>{job.url}</strong>
                  <span className={`job-type-badge ${job.type}`}>{job.type}</span>
                </span>
                <span className="progress-bar-wrapper">
                  <span className="progress-bar-fill" style={{ width: `${job.progress || 0}%` }} />
                </span>
                <span className="job-meta">
                  <span className={`job-status-badge ${job.status}`}>{job.status}</span>
                  <span>{job.progress || 0}%</span>
                  <span>{durationLabel(job)}</span>
                  <span>attempt {job.attempt_count || 0}/{job.max_attempts || 3}</span>
                </span>
                {job.next_attempt_at && <span className="retry-note">Retry at {formatDate(job.next_attempt_at)}</span>}
              </button>
              <div className="job-actions">
                {job.status === 'downloading' || job.status === 'pending' ? (
                  <button type="button" className="icon-btn danger" title="Cancel job" onClick={() => runAction(`/api/queue/${job.id}/cancel`)}>Cancel</button>
                ) : null}
                {job.status === 'failed' || job.status === 'cancelled' ? (
                  <button type="button" className="icon-btn" title="Retry job" onClick={() => runAction(`/api/queue/${job.id}/retry`)}>Retry</button>
                ) : null}
                {job.status !== 'downloading' ? (
                  <button type="button" className="icon-btn" title="Delete entry" onClick={() => runAction(`/api/queue/${job.id}`, 'DELETE')}>Delete</button>
                ) : null}
              </div>
            </article>
          ))}
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
