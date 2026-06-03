import React, { useEffect, useState } from 'react';

const formatDate = (isoString) => {
  if (!isoString) return 'Never checked';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
};

export default function ChannelManager({ onNavigateToQueue }) {
  const [channels, setChannels] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchChannels = async () => {
    const res = await fetch('/api/channels');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to load profiles');
    setChannels(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    fetchChannels().catch((err) => setError(err.message));
  }, []);

  const monitorProfile = async (url) => {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || data.error || 'Failed to add profile');
    return data;
  };

  const handleAddChannel = async (e) => {
    e.preventDefault();
    if (!newUrl.trim()) return;

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const data = await monitorProfile(newUrl.trim());
      setNewUrl('');
      setMessage(`${data.channelId} queued as job #${data.job?.id || 'pending'}.`);
      await fetchChannels();

      if (onNavigateToQueue) {
        setTimeout(onNavigateToQueue, 700);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveChannel = async (channelId) => {
    if (!confirm(`Stop monitoring ${channelId}? Existing downloaded media will not be deleted.`)) {
      return;
    }

    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}`, {
        method: 'DELETE'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || 'Failed to stop monitoring profile');
      setMessage(`${channelId} monitoring stopped.`);
      await fetchChannels();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemonitor = async (url) => {
    setError('');
    setMessage('');
    try {
      const data = await monitorProfile(url);
      setMessage(`${data.channelId} monitoring restored.`);
      await fetchChannels();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="channel-console">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2 className="logo-text">Monitor profile</h2>
            <p>Add a TikTok profile URL or handle and immediately queue a scan.</p>
          </div>
        </div>

        <form onSubmit={handleAddChannel} className="inline-action-form">
          <div className="form-group grow-field">
            <label className="form-label">TikTok profile URL or @handle</label>
            <input
              type="text"
              className="text-input"
              placeholder="@khaby.lame"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              disabled={loading}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Adding...' : 'Monitor profile'}
          </button>
        </form>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert danger">{error}</div>}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2 className="logo-text">Monitored profiles</h2>
            <p>{channels.length} profiles tracked in channels.txt.</p>
          </div>
        </div>

        {channels.length === 0 ? (
          <div className="empty-state">
            <h3>No profiles monitored yet</h3>
            <p>Added profiles are scanned periodically and their downloaded posts appear in Archive.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="channel-table">
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Status</th>
                  <th>Archive count</th>
                  <th>Last scanned</th>
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
                          <div className="channel-name">@{chan.username}</div>
                          <a href={chan.url} target="_blank" rel="noopener noreferrer" className="muted-link">
                            Open TikTok
                          </a>
                        </div>
                      </div>
                    </td>
                    <td data-label="Status">
                      <span className={`state-badge ${chan.is_monitored ? 'ok' : 'muted'}`}>
                        {chan.is_monitored ? 'Monitored' : 'Inactive'}
                      </span>
                    </td>
                    <td data-label="Archive count" className="strong-cell">
                      {chan.downloaded_count} posts
                    </td>
                    <td data-label="Last scanned" className="muted-cell">
                      {formatDate(chan.last_checked_at)}
                    </td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        {chan.is_monitored ? (
                          <button type="button" className="btn btn-secondary danger-text" onClick={() => handleRemoveChannel(chan.id)}>
                            Stop
                          </button>
                        ) : (
                          <button type="button" className="btn btn-secondary" onClick={() => handleRemonitor(chan.url)}>
                            Re-monitor
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
