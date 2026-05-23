import React, { useState, useEffect } from 'react';

export default function CookieEditor() {
  const [cookies, setCookies] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchCookies = async () => {
    try {
      const res = await fetch('/api/cookies');
      const data = await res.json();
      setCookies(data.cookies || '');
    } catch (err) {
      console.error('Error fetching cookies:', err);
      setError('Failed to fetch existing cookies.');
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
      const res = await fetch('/api/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save cookies');
      }

      setMessage('Cookies saved successfully! They will now be used for all future downloads.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div className="glass-panel" style={{ padding: '2.5rem' }}>
        <h2 className="logo-text" style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Authentication Cookies</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.95rem', lineHeight: '1.6' }}>
          If TikTok blocks downloads, throws rate limit errors, or restricts private videos, paste your browser session cookies below. The cookies must be in **Netscape / Mozilla format**.
        </p>

        <form onSubmit={handleSave}>
          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label">Netscape Cookie Format (cookies.txt)</label>
            <textarea
              className="cookies-textarea"
              placeholder="# Netscape HTTP Cookie File&#10;# http://curl.haxx.se/rfc/cookie_spec.html&#10;# This is a generated file! Do not edit.&#10;.tiktok.com	TRUE	/	TRUE	1716503990	sessionid	xyz123abc..."
              value={cookies}
              onChange={(e) => setCookies(e.target.value)}
              disabled={loading}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Cookies'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={fetchCookies}
              disabled={loading}
            >
              Reload
            </button>
          </div>
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
              fontWeight: 600
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
              fontWeight: 600
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ marginTop: '2rem', padding: '2rem' }}>
        <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.75rem', fontWeight: 700 }}>📖 How to Export Cookies:</h3>
        <ol style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.7', paddingLeft: '1.2rem' }}>
          <li>
            Install a browser extension like <strong>"Get cookies.txt LOCALLY"</strong> or <strong>"Export cookies"</strong> (available on Chrome Web Store and Firefox Add-ons).
          </li>
          <li>Open TikTok in your browser and ensure you are logged in to your account.</li>
          <li>Click the extension icon and select <strong>"Export cookies for tiktok.com"</strong> (choose the <code>Netscape</code> format option).</li>
          <li>Copy the entire text from the exported file and paste it into the textarea above, then click <strong>"Save Cookies"</strong>.</li>
        </ol>
      </div>
    </div>
  );
}
