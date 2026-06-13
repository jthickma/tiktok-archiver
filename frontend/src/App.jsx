import React, { useEffect, useMemo, useState } from 'react';
import MediaBrowser from './components/MediaBrowser';
import ChannelManager from './components/ChannelManager';
import DownloaderForm from './components/DownloaderForm';
import CookieEditor from './components/CookieEditor';
import LogQueue from './components/LogQueue';
import SystemOverview from './components/SystemOverview';
import { requestJson } from './utils/api';
import { formatBytes } from './utils/format';

const tabs = [
  { id: 'browser', label: 'Archive', icon: 'grid' },
  { id: 'channels', label: 'Profiles', icon: 'users' },
  { id: 'downloader', label: 'Download', icon: 'download' },
  { id: 'queue', label: 'Queue', icon: 'terminal' },
  { id: 'cookies', label: 'Cookies', icon: 'lock' }
];

function Icon({ name }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'users') return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>;
  if (name === 'download') return <svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
  if (name === 'terminal') return <svg {...common}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>;
  if (name === 'lock') return <svg {...common}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
  return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('browser');
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      setStatusLoading(true);
      setStatus(await requestJson('/api/status', {}, 'Status request failed'));
    } catch (error) {
      setStatus({ offline: true, error: error.message });
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const counts = status?.queue?.counts || {};
  const activeTasks = status?.queue?.activeCount ?? ((counts.pending || 0) + (counts.downloading || 0));
  const toolsOk = status?.tools && Object.values(status.tools).every(Boolean);
  const storageOk = status?.storage?.dataDirWritable && status?.storage?.downloadsDirWritable;
  const systemReady = !status?.offline && toolsOk && storageOk;

  const pageTitle = useMemo(() => tabs.find((tab) => tab.id === activeTab)?.label || 'Archive', [activeTab]);

  const renderContent = () => {
    if (activeTab === 'channels') return <ChannelManager onNavigateToQueue={() => setActiveTab('queue')} />;
    if (activeTab === 'downloader') return <DownloaderForm onNavigateToQueue={() => setActiveTab('queue')} />;
    if (activeTab === 'cookies') return <CookieEditor />;
    if (activeTab === 'queue') return <LogQueue onQueueChanged={fetchStatus} />;
    return <MediaBrowser />;
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <span className="brand-icon">T</span>
          <span className="brand-text">TikTok Archiver</span>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
              {tab.id === 'queue' && activeTasks > 0 && <span className="nav-count">{activeTasks}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className={`status-dot ${status?.offline ? 'danger' : 'success'}`} />
          <span>{status?.offline ? 'API offline' : status?.queue?.isPaused ? 'Queue paused' : 'System online'}</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>{pageTitle}</h1>
            <p>{status?.offline ? status.error : `${activeTasks} active tasks / ${counts.failed || 0} failed jobs / ${status?.queue?.totalCount || 0} total jobs`}</p>
          </div>
          <div className="topbar-actions">
            <div className="status-strip" aria-label="System status">
              <span className={`status-chip ${systemReady ? 'ok' : 'warn'}`}>{systemReady ? 'Ready' : 'Needs attention'}</span>
              <span className={`status-chip ${toolsOk ? 'ok' : 'warn'}`}>Tools {toolsOk ? 'ready' : 'check'}</span>
              <span className={`status-chip ${storageOk ? 'ok' : 'warn'}`}>Storage {storageOk ? 'writable' : 'blocked'}</span>
              <span className="status-chip">Free {formatBytes(status?.storage?.disk?.bytesFree)}</span>
            </div>
            <button type="button" className="icon-btn refresh-btn" onClick={fetchStatus} disabled={statusLoading}>
              {statusLoading ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </header>

        <section className="metrics-row" aria-label="Queue summary">
          <button type="button" className="metric" onClick={() => setActiveTab('queue')}>
            <span className="metric-value">{counts.downloading || 0}</span>
            <span className="metric-label">Downloading</span>
          </button>
          <button type="button" className="metric" onClick={() => setActiveTab('queue')}>
            <span className="metric-value">{counts.pending || 0}</span>
            <span className="metric-label">Pending</span>
          </button>
          <button type="button" className="metric" onClick={() => setActiveTab('queue')}>
            <span className="metric-value">{counts.failed || 0}</span>
            <span className="metric-label">Failed</span>
          </button>
          <button type="button" className="metric" onClick={() => setActiveTab('queue')}>
            <span className="metric-value">{counts.completed || 0}</span>
            <span className="metric-label">Completed</span>
          </button>
        </section>

        <SystemOverview status={status} />

        <section className="content-view">
          {renderContent()}
        </section>
      </main>
    </div>
  );
}
