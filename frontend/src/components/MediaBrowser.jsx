import React, { useEffect, useMemo, useState } from 'react';

const fallbackThumb = (type) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 420'%3E%3Crect width='320' height='420' fill='%2313171f'/%3E%3Ccircle cx='160' cy='178' r='46' fill='%2328313d'/%3E%3Ctext x='160' y='258' text-anchor='middle' fill='%2398a2b3' font-family='Arial' font-size='22'%3E${type === 'slideshow' ? 'SLIDES' : 'VIDEO'}%3C/text%3E%3C/svg%3E`;

const getAvatarColor = (username) => {
  if (!username) return 'linear-gradient(135deg, #27d3c3, #6aa7ff)';
  const clean = username.replace(/^@/, '');
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    'linear-gradient(135deg, #27d3c3, #0d9488)',
    'linear-gradient(135deg, #f0526d, #b91c1c)',
    'linear-gradient(135deg, #6aa7ff, #1d4ed8)',
    'linear-gradient(135deg, #f0b83a, #b45309)',
    'linear-gradient(135deg, #a855f7, #6b21a8)',
    'linear-gradient(135deg, #ec4899, #be185d)',
    'linear-gradient(135deg, #10b981, #047857)'
  ];
  const idx = Math.abs(hash) % colors.length;
  return colors[idx];
};

export default function MediaBrowser() {
  const [posts, setPosts] = useState([]);
  const [channels, setChannels] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(36);
  const [search, setSearch] = useState('');
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [selectedType, setSelectedType] = useState('');
  const [sort, setSort] = useState('upload_date');
  const [direction, setDirection] = useState('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [missingThumbnail, setMissingThumbnail] = useState(false);
  const [density, setDensity] = useState('compact');
  const [activePost, setActivePost] = useState(null);
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [error, setError] = useState('');
  const [pendingNavigation, setPendingNavigation] = useState(null);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page,
      limit,
      sort,
      direction,
      search,
      channel_id: selectedChannels.join(','),
      type: selectedType,
      date_from: dateFrom,
      date_to: dateTo,
      missing_thumbnail: missingThumbnail ? '1' : ''
    });
    return params.toString();
  }, [page, limit, sort, direction, search, selectedChannels, selectedType, dateFrom, dateTo, missingThumbnail]);

  const fetchPosts = async () => {
    try {
      setError('');
      const res = await fetch(`/api/posts?${queryString}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to load archive');
      setPosts(data.posts || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
      setPendingNavigation(null);
    }
  };

  const handlePrevPost = () => {
    if (!activePost) return;
    const currentIndex = posts.findIndex((p) => p.id === activePost.id);
    if (currentIndex > 0) {
      openPost(posts[currentIndex - 1]);
    } else if (page > 1) {
      setPendingNavigation('last');
      setPage(page - 1);
    }
  };

  const handleNextPost = () => {
    if (!activePost) return;
    const currentIndex = posts.findIndex((p) => p.id === activePost.id);
    if (currentIndex < posts.length - 1) {
      openPost(posts[currentIndex + 1]);
    } else if (page < totalPages) {
      setPendingNavigation('first');
      setPage(page + 1);
    }
  };

  // Handle auto-selection after cross-page navigation
  useEffect(() => {
    if (pendingNavigation && posts.length > 0) {
      if (pendingNavigation === 'first') {
        openPost(posts[0]);
      } else if (pendingNavigation === 'last') {
        openPost(posts[posts.length - 1]);
      }
      setPendingNavigation(null);
    }
  }, [posts, pendingNavigation]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!activePost) return;

      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }

      if (e.key === 'Escape') {
        setActivePost(null);
      } else if (e.key === 'ArrowLeft') {
        handlePrevPost();
      } else if (e.key === 'ArrowRight') {
        handleNextPost();
      } else if (e.key === 'ArrowUp') {
        if (activePost.type === 'slideshow' && slides.length > 1) {
          e.preventDefault();
          setSlideIndex((prev) => (prev - 1 + slides.length) % slides.length);
        }
      } else if (e.key === 'ArrowDown') {
        if (activePost.type === 'slideshow' && slides.length > 1) {
          e.preventDefault();
          setSlideIndex((prev) => (prev + 1) % slides.length);
        }
      } else if (e.key === ' ') {
        if (activePost.type === 'video') {
          e.preventDefault();
          const videoEl = document.querySelector('.media-modal-viewer video');
          if (videoEl) {
            if (videoEl.paused) {
              videoEl.play().catch(() => {});
            } else {
              videoEl.pause();
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePost, posts, page, totalPages, slides, pendingNavigation]);

  const fetchChannels = async () => {
    const res = await fetch('/api/channels');
    const data = await res.json();
    setChannels(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    fetchPosts();
  }, [queryString]);

  useEffect(() => {
    fetchChannels();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, selectedChannels, selectedType, sort, direction, dateFrom, dateTo, missingThumbnail, limit]);

  const toggleChannel = (id) => {
    setSelectedChannels((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const openPost = async (post) => {
    setActivePost(post);
    setSlides([]);
    setSlideIndex(0);
    if (post.type === 'slideshow') {
      const res = await fetch(`/api/posts/${post.id}`);
      const data = await res.json();
      setSlides(data.images || []);
    }
  };

  return (
    <div className="archive-console">
      {error && <div className="alert danger">{error}</div>}

      <div className="toolbar">
        <input
          className="text-input search-input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title, caption, or profile"
        />
        <select className="select-input" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="upload_date">Upload date</option>
          <option value="downloaded_at">Download date</option>
          <option value="profile">Profile</option>
          <option value="type">Type</option>
          <option value="title">Title</option>
        </select>
        <button type="button" className="icon-btn" onClick={() => setDirection(direction === 'desc' ? 'asc' : 'desc')} title="Toggle sort direction">
          {direction === 'desc' ? 'DESC' : 'ASC'}
        </button>
        <select className="select-input" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
          <option value={24}>24</option>
          <option value={36}>36</option>
          <option value={60}>60</option>
          <option value={100}>100</option>
        </select>
      </div>

      <div className="filter-dock">
        <div className="segmented-control">
          {['', 'video', 'slideshow'].map((type) => (
            <button key={type || 'all'} type="button" className={selectedType === type ? 'active' : ''} onClick={() => setSelectedType(type)}>
              {type || 'all'}
            </button>
          ))}
        </div>
        <label className="check-pill">
          <input type="checkbox" checked={missingThumbnail} onChange={(event) => setMissingThumbnail(event.target.checked)} />
          Missing thumbnail
        </label>
        <input className="date-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Start date" />
        <input className="date-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="End date" />
        <div className="segmented-control">
          {['dense', 'compact', 'wide'].map((mode) => (
            <button key={mode} type="button" className={density === mode ? 'active' : ''} onClick={() => setDensity(mode)}>
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="profile-filter" aria-label="Profile filters">
        {channels.map((channel) => (
          <button
            key={channel.id}
            type="button"
            className={selectedChannels.includes(channel.id) ? 'active' : ''}
            onClick={() => toggleChannel(channel.id)}
          >
            @{channel.username}
          </button>
        ))}
      </div>

      <div className="bulk-bar">
        <span>{total} total</span>
      </div>

      {posts.length === 0 ? (
        <div className="empty-state">No archived media matches this view.</div>
      ) : (
        <div className={`media-grid density-${density}`}>
          {posts.map((post) => (
            <article key={post.id} className="media-card">
              <button type="button" className="media-open" onClick={() => openPost(post)}>
                <span className="media-thumbnail-wrapper">
                  <img
                    src={post.thumbnail_path ? `/media/${post.thumbnail_path}` : fallbackThumb(post.type)}
                    alt={post.title || post.description || post.id}
                    className="media-thumbnail"
                    loading="lazy"
                    onError={(event) => { event.currentTarget.src = fallbackThumb(post.type); }}
                  />
                  <span className={`media-badge ${post.type}`}>{post.type}</span>
                </span>
                <span className="media-info">
                  <span className="media-author">@{post.channel_id.replace(/^@/, '')}</span>
                  <strong>{post.title || post.description || 'Untitled TikTok post'}</strong>
                  <span className="media-meta">{post.upload_date || 'No date'} / downloaded {post.downloaded_at?.slice(0, 10) || 'unknown'}</span>
                </span>
              </button>
              {post.type !== 'slideshow' && (
                <a className="card-download-btn visible" href={`/api/posts/${post.id}/download`} title="Download media" download>DL</a>
              )}
            </article>
          ))}
        </div>
      )}

      <div className="pagination-controls">
        <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="pagination-label">Page {page} of {totalPages}</span>
        <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
      </div>

      {activePost && (
        <div className="modal-overlay" onClick={() => setActivePost(null)}>
          <div className="modal-container media-modal-container" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close-btn" onClick={() => setActivePost(null)} aria-label="Close">✕</button>
            
            <div className="media-player-layout">
              {/* Left side: Media Viewer (Video or Slideshow) */}
              <div className="media-viewer-pane">
                {/* Previous Button Overlay */}
                <button 
                  type="button" 
                  className="nav-arrow-overlay prev-arrow" 
                  onClick={handlePrevPost} 
                  title="Previous Video (←)"
                  aria-label="Previous Video"
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                </button>

                {/* Media content */}
                <div className="media-modal-viewer">
                  {activePost.type === 'video' ? (
                    <video 
                      controls 
                      autoPlay 
                      playsInline 
                      src={`/media/${activePost.file_path}`} 
                    />
                  ) : (
                    <div className="slideshow-view">
                      {slides.length > 0 ? (
                        <img src={`/media/${activePost.file_path}/${slides[slideIndex]}`} alt={`Slide ${slideIndex + 1}`} />
                      ) : (
                        <div className="empty-state">No slide files found.</div>
                      )}
                      {slides.length > 1 && (
                        <div className="slide-indicator-pills">
                          {slides.map((_, idx) => (
                            <button 
                              key={idx} 
                              type="button" 
                              className={`slide-indicator-dot ${idx === slideIndex ? 'active' : ''}`}
                              onClick={() => setSlideIndex(idx)}
                              title={`Go to slide ${idx + 1}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Next Button Overlay */}
                <button 
                  type="button" 
                  className="nav-arrow-overlay next-arrow" 
                  onClick={handleNextPost} 
                  title="Next Video (→)"
                  aria-label="Next Video"
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>

                {/* Slideshow specific HUD controls */}
                {activePost.type === 'slideshow' && slides.length > 1 && (
                  <div className="slideshow-hud-controls">
                    <button 
                      type="button" 
                      className="hud-slide-btn prev-slide" 
                      onClick={() => setSlideIndex((slideIndex - 1 + slides.length) % slides.length)}
                      title="Previous Slide (↑)"
                    >
                      ▲
                    </button>
                    <span className="hud-slide-counter">{slideIndex + 1} / {slides.length}</span>
                    <button 
                      type="button" 
                      className="hud-slide-btn next-slide" 
                      onClick={() => setSlideIndex((slideIndex + 1) % slides.length)}
                      title="Next Slide (↓)"
                    >
                      ▼
                    </button>
                  </div>
                )}
              </div>

              {/* Right side: Metadata/Info Panel */}
              <div className="media-info-pane">
                <div className="info-pane-header">
                  <div className="author-badge-container">
                    <div className="author-avatar-circle" style={{ background: getAvatarColor(activePost.channel_id) }}>
                      {activePost.channel_id.replace(/^@/, '').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="author-meta-text">
                      <span className="author-username">@{activePost.channel_id.replace(/^@/, '')}</span>
                      <span className="post-type-badge">{activePost.type}</span>
                    </div>
                  </div>
                </div>

                <div className="info-pane-body">
                  <div className="post-caption-section">
                    <h3 className="caption-heading">Caption</h3>
                    <p className="post-caption-text">{activePost.description || activePost.title || 'No caption available'}</p>
                  </div>

                  <div className="post-stats-section">
                    <div className="stat-row">
                      <span className="stat-label">Upload Date</span>
                      <span className="stat-value">{activePost.upload_date || 'Unknown'}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">Archived At</span>
                      <span className="stat-value">{activePost.downloaded_at ? new Date(activePost.downloaded_at).toLocaleString() : 'Unknown'}</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-label">File Name</span>
                      <span className="stat-value file-path-text" title={activePost.file_path}>
                        {activePost.file_path?.split('/').pop() || 'Unknown'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="info-pane-footer">
                  {activePost.type !== 'slideshow' ? (
                    <a href={`/api/posts/${activePost.id}/download`} className="btn-action-primary download-action-btn" download>
                      <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download Video
                    </a>
                  ) : (
                    <div className="slideshow-download-fallback-message">
                      Slideshow images are stored in: <code className="slide-dir-code">{activePost.file_path}</code>
                    </div>
                  )}
                  
                  {/* Mobile navigation controls helper bar */}
                  <div className="mobile-only-control-bar">
                    <button type="button" className="btn btn-secondary mobile-nav-btn" onClick={handlePrevPost}>
                      ◀ Prev
                    </button>
                    <span className="mobile-nav-page-indicator">
                      {posts.findIndex((p) => p.id === activePost.id) + 1} / {posts.length}
                    </span>
                    <button type="button" className="btn btn-secondary mobile-nav-btn" onClick={handleNextPost}>
                      Next ▶
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
