import React, { useState, useEffect } from 'react';
import MediaBrowser from './components/MediaBrowser';
import ChannelManager from './components/ChannelManager';
import DownloaderForm from './components/DownloaderForm';
import CookieEditor from './components/CookieEditor';
import LogQueue from './components/LogQueue';

export default function App() {
  const [activeTab, setActiveTab] = useState('browser');
  const [stats, setStats] = useState({
    monitoredChannels: 0,
    totalVideos: 0,
    totalSlideshows: 0,
    activeTasks: 0
  });

  const fetchStats = async () => {
    try {
      // Fetch channels
      const channelsRes = await fetch('/api/channels');
      const channels = await channelsRes.json();
      const monitoredCount = channels.filter(c => c.is_monitored === 1).length;

      // Fetch posts count
      const postsRes = await fetch('/api/posts?limit=1');
      const postsData = await postsRes.json();
      const totalPosts = postsData.total || 0;

      // Fetch separate counts for videos/slideshows
      const videosRes = await fetch('/api/posts?type=video&limit=1');
      const videosData = await videosRes.json();
      const totalVideos = videosData.total || 0;

      const slideshowsRes = await fetch('/api/posts?type=slideshow&limit=1');
      const slideshowsData = await slideshowsRes.json();
      const totalSlideshows = slideshowsData.total || 0;

      // Fetch queue active count
      const queueRes = await fetch('/api/queue');
      const queueData = await queueRes.json();
      const activeCount = queueData.active ? queueData.active.length : 0;

      setStats({
        monitoredChannels: monitoredCount,
        totalVideos,
        totalSlideshows,
        activeTasks: activeCount
      });
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
    }
  };

  useEffect(() => {
    fetchStats();
    // Poll stats occasionally
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [activeTab]);

  const renderContent = () => {
    switch (activeTab) {
      case 'browser':
        return <MediaBrowser />;
      case 'channels':
        return <ChannelManager onNavigateToQueue={() => setActiveTab('queue')} />;
      case 'downloader':
        return <DownloaderForm onNavigateToQueue={() => setActiveTab('queue')} />;
      case 'cookies':
        return <CookieEditor />;
      case 'queue':
        return <LogQueue />;
      default:
        return <MediaBrowser />;
    }
  };

  const getPageTitle = () => {
    switch (activeTab) {
      case 'browser':
        return 'Media Archive';
      case 'channels':
        return 'Monitored Profiles';
      case 'downloader':
        return 'On-Demand Downloader';
      case 'cookies':
        return 'Authentication Cookies';
      case 'queue':
        return 'Active Tasks & Queue';
      default:
        return 'Dashboard';
    }
  };

  return (
    <div className="app-container">
      {/* SIDEBAR NAVIGATION */}
      <aside className="sidebar">
        <div className="logo">
          {/* SVG Custom Favicon */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.62 2.89 2.89 0 0 1 2.31-4.51c.36 0 .7.06 1.02.18V9.25a6.32 6.32 0 0 0-1.02-.08 6.34 6.34 0 0 0-6.2 5.17 6.34 6.34 0 0 0 5.17 7.37 6.33 6.33 0 0 0 7.23-6.07V7.83a8.3 8.3 0 0 0 4.14 1.34V5.72a4.8 4.8 0 0 1-1-.22z" />
          </svg>
          <span className="logo-text">TikTok Archiver</span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          <ul className="nav-links">
            <li
              className={`nav-item ${activeTab === 'browser' ? 'active' : ''}`}
              onClick={() => setActiveTab('browser')}
            >
              {/* Media Browser Icon */}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" />
                <rect x="14" y="3" width="7" height="5" />
                <rect x="14" y="12" width="7" height="9" />
                <rect x="3" y="16" width="7" height="5" />
              </svg>
              Media Archive
            </li>
            <li
              className={`nav-item ${activeTab === 'channels' ? 'active' : ''}`}
              onClick={() => setActiveTab('channels')}
            >
              {/* Profile Manager Icon */}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Monitored Profiles
            </li>
            <li
              className={`nav-item ${activeTab === 'downloader' ? 'active' : ''}`}
              onClick={() => setActiveTab('downloader')}
            >
              {/* On-Demand Downloader Icon */}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              On-Demand Tool
            </li>
            <li
              className={`nav-item ${activeTab === 'cookies' ? 'active' : ''}`}
              onClick={() => setActiveTab('cookies')}
            >
              {/* Cookies Authentication Icon */}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Auth Cookies
            </li>
            <li
              className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}
              onClick={() => setActiveTab('queue')}
            >
              {/* Log Queue Icon */}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              Active Tasks
              {stats.activeTasks > 0 && (
                <span
                  style={{
                    marginLeft: 'auto',
                    background: 'var(--status-info)',
                    color: 'white',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '0.15rem 0.45rem',
                    borderRadius: '10px',
                    animation: 'pulsePulse 1.5s infinite'
                  }}
                >
                  {stats.activeTasks}
                </span>
              )}
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="status-badge">
            <span className="status-dot"></span>
            Server Status: ONLINE
          </div>
        </div>
      </aside>

      {/* MAIN DASHBOARD CONTENT AREA */}
      <main className="main-content">
        <header className="dashboard-header">
          <h1 className="page-title">{getPageTitle()}</h1>
        </header>

        {/* TOP DASHBOARD STATS CARD GRID */}
        <section className="stats-grid">
          <div className="stat-card" onClick={() => setActiveTab('channels')} style={{ cursor: 'pointer' }}>
            <div className="stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.monitoredChannels}</span>
              <span className="stat-label">Monitored Profiles</span>
            </div>
          </div>

          <div className="stat-card" onClick={() => setActiveTab('browser')} style={{ cursor: 'pointer' }}>
            <div className="stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.totalVideos}</span>
              <span className="stat-label">Archived Videos</span>
            </div>
          </div>

          <div className="stat-card" onClick={() => setActiveTab('browser')} style={{ cursor: 'pointer' }}>
            <div className="stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.totalSlideshows}</span>
              <span className="stat-label">Archived Slideshows</span>
            </div>
          </div>

          <div className="stat-card" onClick={() => setActiveTab('queue')} style={{ cursor: 'pointer' }}>
            <div className="stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="12" x2="2" y2="12" />
                <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                <line x1="6" y1="16" x2="6.01" y2="16" />
                <line x1="10" y1="16" x2="10.01" y2="16" />
              </svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">{stats.activeTasks}</span>
              <span className="stat-label">Active Tasks</span>
            </div>
          </div>
        </section>

        {/* ACTIVE TAB CONTENT VIEW */}
        <section style={{ animation: 'fadeIn 0.3s ease-out' }}>
          {renderContent()}
        </section>
      </main>
    </div>
  );
}
