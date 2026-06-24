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
  { id: 'browser', label: 'Archive', shortLabel: 'Archive', icon: 'grid', description: 'Browse and manage your saved media.' },
  { id: 'channels', label: 'Profiles', shortLabel: 'Profiles', icon: 'users', description: 'Monitor creators and keep their archives current.' },
  { id: 'downloader', label: 'New download', shortLabel: 'Download', icon: 'download', description: 'Save a post, profile, gallery, or direct media link.' },
  { id: 'queue', label: 'Activity', shortLabel: 'Activity', icon: 'terminal', description: 'Track active jobs, history, and worker output.' },
  { id: 'cookies', label: 'Access', shortLabel: 'Access', icon: 'lock', description: 'Manage authentication used by restricted downloads.' }
];

function Icon({ name }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.9',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };
  if (name === 'users') return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  if (name === 'download') return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 21h14a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2" /></svg>;
  if (name === 'terminal') return <svg {...common}><path d="m5 7 5 5-5 5M13 17h6" /></svg>;
  if (name === 'lock') return <svg {...common}><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  if (name === 'refresh') return <svg {...common}><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" /></svg>;
  if (name === 'install') return <svg {...common}><path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>;
  return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /></svg>;
}

function Brand() {
  return (
    <div className="brand-mark">
      <span className="brand-icon" aria-hidden="true">
        <span>T</span>
      </span>
      <span className="brand-copy">
        <strong>TikTok Archiver</strong>
        <small>Private media library</small>
      </span>
    </div>
  );
}

export default function App() {
  const initialTab = window.location.hash.replace('#', '');
  const [activeTab, setActiveTab] = useState(tabs.some((tab) => tab.id === initialTab) ? initialTab : 'browser');
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [updateReady, setUpdateReady] = useState(false);

  const navigate = (tabId) => {
    setActiveTab(tabId);
    window.history.replaceState(null, '', `#${tabId}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

  useEffect(() => {
    const handleHashChange = () => {
      const nextTab = window.location.hash.replace('#', '');
      if (tabs.some((tab) => tab.id === nextTab)) setActiveTab(nextTab);
    };
    const handleBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleUpdate = () => setUpdateReady(true);

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('pwa:update-ready', handleUpdate);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('pwa:update-ready', handleUpdate);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const counts = status?.queue?.counts || {};
  const activeTasks = status?.queue?.activeCount ?? ((counts.pending || 0) + (counts.downloading || 0));
  const toolsOk = Boolean(status?.tools) && Object.values(status.tools).every(Boolean);
  const storageOk = Boolean(status?.storage?.dataDirWritable && status?.storage?.downloadsDirWritable);
  const systemReady = isOnline && !status?.offline && toolsOk && storageOk;
  const activePage = useMemo(() => tabs.find((tab) => tab.id === activeTab) || tabs[0], [activeTab]);

  const renderContent = () => {
    if (activeTab === 'channels') return <ChannelManager onNavigateToQueue={() => navigate('queue')} />;
    if (activeTab === 'downloader') return <DownloaderForm onNavigateToQueue={() => navigate('queue')} />;
    if (activeTab === 'cookies') return <CookieEditor />;
    if (activeTab === 'queue') return <LogQueue onQueueChanged={fetchStatus} />;
    return <MediaBrowser />;
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />

        <nav className="primary-nav" aria-label="Primary navigation">
          <span className="nav-eyebrow">Workspace</span>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => navigate(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <span className="nav-icon"><Icon name={tab.icon} /></span>
              <span>{tab.label}</span>
              {tab.id === 'queue' && activeTasks > 0 && <span className="nav-count">{activeTasks}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {installPrompt && !isInstalled && (
            <button type="button" className="install-card" onClick={installApp}>
              <Icon name="install" />
              <span><strong>Install app</strong><small>Open faster from your device</small></span>
            </button>
          )}
          <div className="sidebar-status">
            <span className={`status-dot ${systemReady ? 'success' : 'danger'}`} />
            <span>
              <strong>{!isOnline ? 'Device offline' : status?.offline ? 'Server unavailable' : status?.queue?.isPaused ? 'Queue paused' : 'System online'}</strong>
              <small>{status?.server?.version ? `Version ${status.server.version}` : 'Self-hosted workspace'}</small>
            </span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {!isOnline && (
          <div className="connection-banner" role="status">
            You are offline. The app shell is available, but archive data and actions need the server.
          </div>
        )}

        <header className="topbar">
          <div className="page-heading">
            <span className="page-eyebrow">Media workspace</span>
            <h1>{activePage.label}</h1>
            <p>{activePage.description}</p>
          </div>
          <div className="topbar-actions">
            <div className="topbar-status">
              <span className={`live-indicator ${systemReady ? 'ready' : ''}`}>
                <span /> {systemReady ? 'Ready' : 'Attention'}
              </span>
              <span className="storage-readout">{formatBytes(status?.storage?.disk?.bytesFree)} free</span>
            </div>
            <button type="button" className="icon-btn refresh-btn" onClick={fetchStatus} disabled={statusLoading}>
              <Icon name="refresh" />
              <span>{statusLoading ? 'Refreshing' : 'Refresh'}</span>
            </button>
            {installPrompt && !isInstalled && (
              <button type="button" className="btn btn-primary desktop-install" onClick={installApp}>
                <Icon name="install" /> Install
              </button>
            )}
          </div>
        </header>

        <section className="metrics-row" aria-label="Queue summary">
          {[
            ['downloading', 'Downloading'],
            ['pending', 'Waiting'],
            ['failed', 'Needs attention'],
            ['completed', 'Completed']
          ].map(([key, label]) => (
            <button type="button" className={`metric metric-${key}`} onClick={() => navigate('queue')} key={key}>
              <span className="metric-label">{label}</span>
              <span className="metric-value">{counts[key] || 0}</span>
              <span className="metric-detail">View activity <span aria-hidden="true">→</span></span>
            </button>
          ))}
        </section>

        <SystemOverview status={status} />

        <section className="content-view" aria-live="polite">
          {renderContent()}
        </section>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`${activeTab === tab.id ? 'active' : ''} ${tab.id === 'downloader' ? 'primary-mobile-action' : ''}`}
            onClick={() => navigate(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <span className="mobile-nav-icon">
              <Icon name={tab.icon} />
              {tab.id === 'queue' && activeTasks > 0 && <span className="mobile-nav-count">{activeTasks}</span>}
            </span>
            <span>{tab.shortLabel}</span>
          </button>
        ))}
      </nav>

      {updateReady && (
        <div className="update-toast" role="status">
          <span><strong>Update ready</strong><small>Reload to use the latest version.</small></span>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
    </div>
  );
}
