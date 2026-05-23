import React, { useState } from 'react';

export default function DownloaderForm({ onNavigateToQueue }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleDownload = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch('/api/download-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit download');
      }

      setMessage(`URL successfully queued for download as a ${data.type}!`);
      setUrl('');

      // Redirect user to Queue/Active Tasks after a short delay so they see the progress
      if (onNavigateToQueue) {
        setTimeout(() => {
          onNavigateToQueue();
        }, 1200);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto' }}>
      <div className="glass-panel" style={{ padding: '3rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '20px',
              background: 'rgba(168, 85, 247, 0.15)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-purple)',
              marginBottom: '1rem'
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <h2 className="page-title" style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>On-Demand Downloader</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Paste any TikTok URL (a video, a photo slideshow, or a profile) to instantly queue it.
          </p>
        </div>

        <form onSubmit={handleDownload}>
          <div className="form-group" style={{ marginBottom: '2rem' }}>
            <label className="form-label">TikTok Link</label>
            <input
              type="text"
              className="text-input"
              style={{ padding: '1.1rem 1.5rem', fontSize: '1.05rem' }}
              placeholder="e.g. https://www.tiktok.com/@user/video/1234567890 or @username"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '1.1rem', fontSize: '1.05rem' }}
            disabled={loading}
          >
            {loading ? 'Queueing download...' : 'Trigger Download'}
          </button>
        </form>

        {message && (
          <div
            style={{
              marginTop: '1.5rem',
              padding: '1rem',
              borderRadius: 'var(--border-radius-md)',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              color: 'var(--status-success)',
              fontWeight: 600,
              textAlign: 'center'
            }}
          >
            {message}
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: '1.5rem',
              padding: '1rem',
              borderRadius: 'var(--border-radius-md)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: 'var(--status-danger)',
              fontWeight: 600,
              textAlign: 'center'
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div style={{ marginTop: '2rem', padding: '0 1rem' }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem', fontWeight: 600 }}>💡 Archiving Tips:</h4>
        <ul style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.6', paddingLeft: '1.2rem' }}>
          <li>Profile URLs (e.g. <code>https://www.tiktok.com/@username</code>) will check for new posts.</li>
          <li>Video URLs will be downloaded immediately into the uploader's subfolder.</li>
          <li>Slideshow URLs will download all images into a folder named after the post ID.</li>
          <li>Duplicate videos or slideshows are automatically detected and skipped.</li>
        </ul>
      </div>
    </div>
  );
}
