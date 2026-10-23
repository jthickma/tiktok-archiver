import React, { useEffect, useRef, useState } from 'react';
import MediaBrowser from './MediaBrowser';
import { requestJson } from '../utils/api';
import { formatDateTime } from '../utils/format';

export default function ChannelManager({ onNavigateToQueue }) {
  const [channels, setChannels] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedChannel, setSelectedChannel] = useState(null);
  const archiveSection = useRef(null);
  const archiveHeading = useRef(null);
  const profileTrigger = useRef(null);
  const profileScroll = useRef(0);

  const openArchive = (channel, event) => {
    profileTrigger.current = event.currentTarget;
    profileScroll.current = window.scrollY;
    setSelectedChannel(channel);
  };

  useEffect(() => {
    if (selectedChannel) {
      archiveHeading.current?.focus({ preventScroll: true });
      archiveSection.current?.scrollIntoView({ block: 'start' });
    } else if (profileTrigger.current) {
      profileTrigger.current.focus({ preventScroll: true });
      window.scrollTo({ top: profileScroll.current });
    }
  }, [selectedChannel]);

  const fetchChannels = async () => {
    const data = await requestJson('/api/channels', {}, 'Failed to load profiles');
    setChannels(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    fetchChannels().catch((err) => setError(err.message));
  }, []);

  const monitorProfile = async (url) => {
    return requestJson('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    }, 'Failed to add profile');
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
      await requestJson(`/api/channels/${encodeURIComponent(channelId)}`, {
        method: 'DELETE'
      }, 'Failed to stop monitoring profile');
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
      {selectedChannel ? (
        <section className="profile-archive" aria-labelledby="profile-archive-heading" ref={archiveSection}>
          <div className="panel profile-archive-header">
            <button type="button" className="btn btn-secondary" onClick={() => setSelectedChannel(null)}>
              <span aria-hidden="true">←</span> Back to profiles
            </button>
            <div className="section-heading">
              <div>
                <h2 id="profile-archive-heading" className="logo-text" tabIndex={-1} ref={archiveHeading}>@{selectedChannel.username}</h2>
                <p>Archived media from this profile. Open any item to watch or view it.</p>
              </div>
              <a href={selectedChannel.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Open TikTok <span aria-hidden="true">↗</span></a>
            </div>
          </div>
          <MediaBrowser key={selectedChannel.id} channelId={selectedChannel.id} />
        </section>
      ) : null}
      <div hidden={Boolean(selectedChannel)}>
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
            <p>{channels.length} profiles tracked. Select a profile to browse its archived media.</p>
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
                        <button type="button" className="channel-avatar-fallback channel-archive-avatar" onClick={(event) => openArchive(chan, event)} aria-label={`View archived media from @${chan.username}`}>
                          {chan.username.slice(0, 1).toUpperCase()}
                        </button>
                        <div>
                          <button type="button" className="channel-name channel-archive-link" onClick={(event) => openArchive(chan, event)} aria-label={`View archive for @${chan.username}`}>@{chan.username}</button>
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
                      {formatDateTime(chan.last_checked_at, 'Never checked')}
                    </td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        <button type="button" className="btn btn-secondary" onClick={(event) => openArchive(chan, event)} aria-label={`View media from @${chan.username}`}>
                          View media
                        </button>
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
    </div>
  );
}
