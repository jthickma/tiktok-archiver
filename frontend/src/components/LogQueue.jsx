import React, { useState, useEffect, useRef } from 'react';

export default function LogQueue() {
  const [activeJobs, setActiveJobs] = useState([]);
  const [historyJobs, setHistoryJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLogs, setJobLogs] = useState('');
  const [logStatus, setLogStatus] = useState('');

  const terminalRef = useRef(null);

  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      setActiveJobs(data.active || []);
      setHistoryJobs(data.history || []);
    } catch (err) {
      console.error('Error fetching queue:', err);
    }
  };

  const fetchLogs = async (jobId) => {
    try {
      const res = await fetch(`/api/queue/${jobId}/logs`);
      const data = await res.json();
      setJobLogs(data.logs || 'No logs gathered yet...');
      setLogStatus(data.status);
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  };

  // Poll the queue every 1.5s
  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 1500);
    return () => clearInterval(interval);
  }, []);

  // Poll logs for the selected job if it is still running
  useEffect(() => {
    if (!selectedJob) {
      setJobLogs('');
      setLogStatus('');
      return;
    }

    fetchLogs(selectedJob.id);

    // If the job is pending or downloading, poll its logs
    const shouldPoll = selectedJob.status === 'pending' || selectedJob.status === 'downloading';
    let logInterval;

    if (shouldPoll) {
      logInterval = setInterval(() => {
        fetchLogs(selectedJob.id);
      }, 1000);
    }

    return () => {
      if (logInterval) clearInterval(logInterval);
    };
  }, [selectedJob]);

  // Auto-scroll terminal to bottom when logs change
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [jobLogs]);

  // Format date helper
  const formatDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className={`queue-layout ${selectedJob ? 'with-console' : ''}`}>
      
      {/* LEFT PANEL: Queue and History */}
      <div>
        {/* Active downloads */}
        <div className="glass-panel" style={{ marginBottom: '2rem' }}>
          <h2 className="logo-text" style={{ fontSize: '1.5rem', marginBottom: '1.25rem' }}>Active Tasks</h2>
          {activeJobs.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', padding: '1rem 0', fontStyle: 'italic', fontSize: '0.95rem' }}>
              No active downloads. The queue is idle.
            </div>
          ) : (
            <div>
              {activeJobs.map((job) => (
                <button
                  type="button"
                  key={job.id}
                  className={`job-item ${selectedJob?.id === job.id ? 'active-selection' : ''}`}
                  onClick={() => setSelectedJob(job)}
                  aria-pressed={selectedJob?.id === job.id}
                  style={{
                    cursor: 'pointer',
                    borderLeft: selectedJob?.id === job.id ? '4px solid var(--accent-purple)' : '1px solid var(--glass-border)'
                  }}
                >
                  <div className="job-header">
                    <span className="job-url" title={job.url}>{job.url}</span>
                    <span className={`job-type-badge ${job.type}`}>{job.type}</span>
                  </div>

                  <div className="progress-bar-wrapper">
                    <div className="progress-bar-fill" style={{ width: `${job.progress}%` }}></div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <span className={`job-status-badge ${job.status}`}>
                      <span className="status-dot" style={{
                        background: job.status === 'downloading' ? 'var(--status-info)' : 'var(--text-muted)',
                        boxShadow: job.status === 'downloading' ? '0 0 8px var(--status-info)' : 'none'
                      }}></span>
                      {job.status === 'downloading' ? 'Downloading...' : 'Pending'}
                    </span>
                    <span>{job.progress}%</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* History downloads */}
        <div className="glass-panel">
          <h2 className="logo-text" style={{ fontSize: '1.5rem', marginBottom: '1.25rem' }}>Download History</h2>
          {historyJobs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '1rem 0', fontStyle: 'italic', fontSize: '0.9rem' }}>
              No historical download entries.
            </div>
          ) : (
            <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '0.5rem' }}>
              {historyJobs.map((job) => (
                <button
                  type="button"
                  key={job.id}
                  className={`job-item`}
                  onClick={() => setSelectedJob(job)}
                  aria-pressed={selectedJob?.id === job.id}
                  style={{
                    cursor: 'pointer',
                    padding: '0.85rem 1.25rem',
                    borderLeft: selectedJob?.id === job.id ? '4px solid var(--accent-purple)' : '1px solid var(--glass-border)'
                  }}
                >
                  <div className="job-header">
                    <span className="job-url" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }} title={job.url}>
                      {job.url}
                    </span>
                    <span className={`job-type-badge ${job.type}`} style={{ fontSize: '0.65rem' }}>
                      {job.type}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    <span className={`job-status-badge ${job.status}`}>
                      {job.status === 'completed' ? '✓ Success' : '✗ Failed'}
                    </span>
                    <span>
                      {formatDate(job.completed_at || job.started_at)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Live Console Terminal logs */}
      {selectedJob && (
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 className="logo-text" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Console Output</h2>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Job #{selectedJob.id}: {selectedJob.url}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
              onClick={() => setSelectedJob(null)}
            >
              Close Console
            </button>
          </div>

          <div
            ref={terminalRef}
            className="terminal-panel"
            style={{ flexGrow: 1, height: '530px', maxHeight: '550px' }}
          >
            {jobLogs}
            {logStatus === 'downloading' && (
              <span style={{ color: 'var(--text-secondary)', animation: 'pulsePulse 1s infinite' }}>
                <br />[System] Waiting for next stdout chunk... █
              </span>
            )}
          </div>

          {selectedJob.status === 'failed' && selectedJob.error_message && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.85rem',
                borderRadius: 'var(--border-radius-sm)',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: 'var(--status-danger)',
                fontSize: '0.85rem',
                fontWeight: 600
              }}
            >
              <strong>Error Trace:</strong> {selectedJob.error_message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
