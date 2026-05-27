import React, { useEffect, useMemo, useState } from 'react';

const fallbackThumb = (type) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 420'%3E%3Crect width='320' height='420' fill='%2313171f'/%3E%3Ccircle cx='160' cy='178' r='46' fill='%2328313d'/%3E%3Ctext x='160' y='258' text-anchor='middle' fill='%2398a2b3' font-family='Arial' font-size='22'%3E${type === 'slideshow' ? 'SLIDES' : 'VIDEO'}%3C/text%3E%3C/svg%3E`;

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
  const [selectedPosts, setSelectedPosts] = useState(new Set());
  const [activePost, setActivePost] = useState(null);
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [error, setError] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const selectedCount = selectedPosts.size;

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
      setSelectedPosts(new Set());
    } catch (err) {
      setError(err.message);
    }
  };

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

  const togglePost = (id) => {
    setSelectedPosts((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const downloadSelectedZip = () => {
    if (selectedCount === 0) return;
    window.location.href = `/api/posts/zip?ids=${encodeURIComponent(Array.from(selectedPosts).join(','))}`;
  };

  const allOnPageSelected = posts.length > 0 && posts.every((post) => selectedPosts.has(post.id));

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
        <label className="check-pill">
          <input
            type="checkbox"
            checked={allOnPageSelected}
            onChange={() => setSelectedPosts(allOnPageSelected ? new Set() : new Set(posts.map((post) => post.id)))}
          />
          Select page
        </label>
        <span>{selectedCount} selected / {total} total</span>
        <button type="button" className="btn btn-secondary" disabled={selectedCount === 0} onClick={downloadSelectedZip}>Zip selected</button>
        <a className="btn btn-secondary" href={`/api/posts/zip${selectedChannels.length === 1 ? `?channel_id=${encodeURIComponent(selectedChannels[0])}` : ''}`}>Zip view</a>
      </div>

      {posts.length === 0 ? (
        <div className="empty-state">No archived media matches this view.</div>
      ) : (
        <div className={`media-grid density-${density}`}>
          {posts.map((post) => (
            <article key={post.id} className={`media-card ${selectedPosts.has(post.id) ? 'selected' : ''}`}>
              <button type="button" className="card-select" onClick={() => togglePost(post.id)} aria-label={`Select ${post.id}`}>
                {selectedPosts.has(post.id) ? 'x' : ''}
              </button>
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
              <a className="card-download-btn visible" href={`/api/posts/${post.id}/download`} title="Download media" download>DL</a>
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
          <div className="modal-container media-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setActivePost(null)} aria-label="Close">x</button>
            {activePost.type === 'video' ? (
              <video controls autoPlay playsInline src={`/media/${activePost.file_path}`} />
            ) : (
              <div className="slideshow-view">
                {slides.length > 0 ? (
                  <img src={`/media/${activePost.file_path}/${slides[slideIndex]}`} alt={`Slide ${slideIndex + 1}`} />
                ) : (
                  <div className="empty-state">No slide files found.</div>
                )}
                {slides.length > 1 && (
                  <div className="slide-controls">
                    <button type="button" className="icon-btn" onClick={() => setSlideIndex((slideIndex - 1 + slides.length) % slides.length)}>{"<"}</button>
                    <span>{slideIndex + 1} / {slides.length}</span>
                    <button type="button" className="icon-btn" onClick={() => setSlideIndex((slideIndex + 1) % slides.length)}>{">"}</button>
                  </div>
                )}
              </div>
            )}
            <div className="modal-body">
              <div className="modal-author-row">
                <strong>@{activePost.channel_id.replace(/^@/, '')}</strong>
                <a href={`/api/posts/${activePost.id}/download`} className="btn btn-secondary" download>Download</a>
              </div>
              <p>{activePost.description || activePost.title}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
