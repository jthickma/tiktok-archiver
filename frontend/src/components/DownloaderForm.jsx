import React, { useState } from 'react';
import { requestJson } from '../utils/api';

export default function DownloaderForm({ onNavigateToQueue }) {
  const [url, setUrl] = useState('');
  const [downloader, setDownloader] = useState('auto');
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
      const data = await requestJson('/api/download-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), downloader })
      }, 'Failed to submit download');

      const jobStatus = data.job?.requeued ? 'requeued' : data.job?.created ? 'queued' : 'already queued';
      const jobLabel = data.type === 'channel' ? 'Profile scan' : data.type === 'gallery-dl' ? 'gallery-dl download' : 'Download';
      setMessage(`${jobLabel} ${jobStatus}. Job #${data.job?.id || 'pending'} is ready in the queue.`);
      setUrl('');

      if (onNavigateToQueue) {
        setTimeout(() => {
          onNavigateToQueue();
        }, 900);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="narrow-page">
      <section className="panel feature-panel">
        <div className="feature-heading">
          <div className="feature-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div>
            <h2 className="page-title">On-demand downloader</h2>
            <p>Queue a TikTok profile, TikTok post, VSCO gallery, or direct media URL.</p>
          </div>
        </div>

        <form onSubmit={handleDownload} className="stacked-form">
          <div className="form-group">
            <label className="form-label">Media link</label>
            <input
              type="text"
              className="text-input input-lg"
              placeholder="https://www.tiktok.com/@user/video/123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Downloader</label>
            <div className="segmented-control download-mode">
              <button type="button" className={downloader === 'auto' ? 'active' : ''} onClick={() => setDownloader('auto')} disabled={loading}>
                Auto
              </button>
              <button type="button" className={downloader === 'gallery-dl' ? 'active' : ''} onClick={() => setDownloader('gallery-dl')} disabled={loading}>
                gallery-dl
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary full-width" disabled={loading}>
            {loading ? 'Queueing...' : 'Queue download'}
          </button>
        </form>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert danger">{error}</div>}
      </section>

      <section className="panel compact-panel">
        <h3>Accepted sources</h3>
        <div className="tip-grid">
          <span>TikTok profiles scan for new posts.</span>
          <span>Post URLs download a single item.</span>
          <span>gallery-dl can be selected for any HTTP URL.</span>
          <span>Archived media appears in the Archive view.</span>
        </div>
      </section>
    </div>
  );
}
