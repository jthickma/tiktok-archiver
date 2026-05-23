import React, { useState, useEffect } from 'react';

export default function ChannelManager({ onNavigateToQueue }) {
  const [channels, setChannels] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchChannels = async () => {
    try {
      const res = await fetch('/api/channels');
      const data = await res.json();
      setChannels(data || []);
    } catch (err) {
      console.error('Error fetching channels:', err);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  const handleAddChannel = async (e) => {
    e.preventDefault();
    if (!newUrl.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add profile');
      }

      setNewUrl('');
      await fetchChannels();
      
      // Navigate user to queue if callback is provided so they can watch the scan progress
      if (onNavigateToQueue) {
        onNavigateToQueue();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveChannel = async (channelId) => {
    if (!confirm(`Are you sure you want to stop monitoring ${channelId}? Existing downloaded media will NOT be deleted.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchChannels();
      }
    } catch (err) {
      console.error('Error removing channel:', err);
    }
  };

  // Format date helper
  const formatDate = (isoString) => {
    if (!isoString) return 'Never checked';
    const date = new Date(isoString);
    return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <div>
      {/* Add Channel Form */}
      <div className="glass-panel" style={{ marginBottom: '2.5rem' }}>
        <h2 className="logo-text" style={{ fontSize: '1.5rem', marginBottom: '1.25rem' }}>Monitor New Profile</h2>
        <form onSubmit={handleAddChannel} className="inline-action-form">
          <div className="form-group" style={{ flexGrow: 1, minWidth: '250px', marginBottom: 0 }}>
            <label className="form-label">TikTok Profile URL or @handle</label>
            <input
              type="text"
              className="text-input"
              placeholder="e.g. https://www.tiktok.com/@khaby.lame or simply @khaby.lame"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              disabled={loading}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Adding...' : 'Monitor Profile'}
          </button>
        </form>
        {error && <div style={{ color: 'var(--status-danger)', marginTop: '1rem', fontWeight: 600 }}>{error}</div>}
      </div>

      {/* Monitored Channels Grid/Table */}
      <div className="glass-panel">
        <h2 className="logo-text" style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Currently Monitored Profiles</h2>
        {channels.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem 0' }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <h3>No profiles monitored yet</h3>
            <p>Monitored profiles are saved in channels.txt and scanned periodically for new videos.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="channel-table">
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Status</th>
                  <th>Archive Count</th>
                  <th>Last Scanned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((chan) => (
                  <tr key={chan.id}>
                    <td data-label="Profile">
                      <div className="channel-row-name">
                        <div className="channel-avatar-fallback">
                          {chan.username.slice(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700 }}>@{chan.username}</div>
                          <a
                            href={chan.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'none' }}
                          >
                            Open TikTok
                          </a>
                        </div>
                      </div>
                    </td>
                    <td data-label="Status">
                      <span
                        style={{
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          color: chan.is_monitored ? 'var(--status-success)' : 'var(--text-muted)',
                          background: chan.is_monitored ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.03)',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          textTransform: 'uppercase'
                        }}
                      >
                        {chan.is_monitored ? 'Monitored' : 'Inactive'}
                      </span>
                    </td>
                    <td data-label="Archive Count" style={{ fontWeight: 700, fontFamily: 'Outfit' }}>
                      {chan.downloaded_count} posts
                    </td>
                    <td data-label="Last Scanned" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      {formatDate(chan.last_checked_at)}
                    </td>
                    <td data-label="Actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {chan.downloaded_count > 0 && (
                        <a
                          href={`/api/posts/zip?channel_id=${encodeURIComponent(chan.id)}`}
                          className="btn btn-secondary"
                          style={{
                            padding: '0.4rem 0.85rem',
                            fontSize: '0.85rem',
                            borderColor: 'var(--accent-purple)',
                            color: 'var(--text-primary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            textDecoration: 'none'
                          }}
                          title={`Zip & Download all ${chan.downloaded_count} posts for @${chan.username}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '0.25rem' }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          Zip Archive
                        </a>
                      )}
                      {chan.is_monitored ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            padding: '0.4rem 0.85rem',
                            fontSize: '0.85rem',
                            color: 'var(--status-danger)',
                            borderColor: 'rgba(239, 68, 68, 0.2)'
                          }}
                          onClick={() => handleRemoveChannel(chan.id)}
                        >
                          Stop Monitoring
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                          onClick={async () => {
                            await fetch('/api/channels', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ url: chan.url })
                            });
                            fetchChannels();
                          }}
                        >
                          Re-monitor
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
