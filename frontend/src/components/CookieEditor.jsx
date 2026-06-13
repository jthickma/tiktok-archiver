import React, { useEffect, useState } from 'react';
import { requestJson } from '../utils/api';

export default function CookieEditor() {
  const [cookies, setCookies] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchCookies = async () => {
    setError('');
    try {
      const data = await requestJson('/api/cookies', {}, 'Failed to fetch existing cookies');
      setCookies(data.cookies || '');
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchCookies();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      await requestJson('/api/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies })
      }, 'Failed to save cookies');

      setMessage('Cookies saved. New downloads will use this cookies.txt file.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="narrow-page wide">
      <section className="panel feature-panel">
        <div className="section-heading">
          <div>
            <h2 className="page-title">Authentication cookies</h2>
            <p>Paste TikTok cookies in Netscape format when downloads hit rate limits or restricted media.</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="stacked-form">
          <div className="form-group">
            <label className="form-label">cookies.txt</label>
            <textarea
              className="cookies-textarea"
              placeholder="# Netscape HTTP Cookie File&#10;.tiktok.com	TRUE	/	TRUE	1716503990	sessionid	xyz123abc..."
              value={cookies}
              onChange={(e) => setCookies(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save cookies'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={fetchCookies} disabled={loading}>
              Reload
            </button>
          </div>
        </form>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert danger">{error}</div>}
      </section>

      <section className="panel compact-panel">
        <h3>Export checklist</h3>
        <ol className="instruction-list">
          <li>Use a browser extension that exports cookies locally in Netscape format.</li>
          <li>Open TikTok while logged in before exporting cookies for tiktok.com.</li>
          <li>Paste the full exported file here, including comment lines.</li>
          <li>Save, then queue or retry the affected download.</li>
        </ol>
      </section>
    </div>
  );
}
