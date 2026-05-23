import React, { useState, useEffect } from 'react';

export default function MediaBrowser() {
  const [posts, setPosts] = useState([]);
  const [channels, setChannels] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(12);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [selectedType, setSelectedType] = useState(''); // '', 'video', 'slideshow'

  // Modals State
  const [activeVideo, setActiveVideo] = useState(null);
  const [activeSlideshow, setActiveSlideshow] = useState(null);
  const [slideshowImages, setSlideshowImages] = useState([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const fetchPosts = async () => {
    try {
      const params = new URLSearchParams({
        page,
        limit,
        search,
        channel_id: selectedChannel,
        type: selectedType
      });
      const res = await fetch(`/api/posts?${params}`);
      const data = await res.json();
      setPosts(data.posts || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Error fetching posts:', err);
    }
  };

  const fetchChannels = async () => {
    try {
      const res = await fetch('/api/channels');
      const data = await res.json();
      setChannels(data || []);
    } catch (err) {
      console.error('Error fetching channels:', err);
    }
  };

  // Trigger fetches
  useEffect(() => {
    fetchPosts();
  }, [page, search, selectedChannel, selectedType]);

  useEffect(() => {
    fetchChannels();
  }, []);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [search, selectedChannel, selectedType]);

  // Handle slideshow open
  const openSlideshow = async (post) => {
    try {
      const res = await fetch(`/api/posts/${post.id}`);
      const data = await res.json();
      setSlideshowImages(data.images || []);
      setCurrentSlideIndex(0);
      setActiveSlideshow(post);
    } catch (err) {
      console.error('Error opening slideshow:', err);
    }
  };

  // Keyboard navigation for slideshow
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!activeSlideshow) return;
      if (e.key === 'ArrowRight') {
        nextSlide();
      } else if (e.key === 'ArrowLeft') {
        prevSlide();
      } else if (e.key === 'Escape') {
        closeSlideshow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSlideshow, slideshowImages, currentSlideIndex]);

  const nextSlide = () => {
    if (slideshowImages.length === 0) return;
    setCurrentSlideIndex((prev) => (prev + 1) % slideshowImages.length);
  };

  const prevSlide = () => {
    if (slideshowImages.length === 0) return;
    setCurrentSlideIndex((prev) => (prev - 1 + slideshowImages.length) % slideshowImages.length);
  };

  const closeSlideshow = () => {
    setActiveSlideshow(null);
    setSlideshowImages([]);
    setCurrentSlideIndex(0);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="filter-bar">
        {/* Search Input */}
        <input
          type="text"
          className="text-input"
          placeholder="Search captions or descriptions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="filter-controls">
          <select
            className="select-input"
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
          >
            <option value="">All Profiles</option>
            {channels.map((chan) => (
              <option key={chan.id} value={chan.id}>
                @{chan.username}
              </option>
            ))}
          </select>

          <div className="tab-group">
            <button
              className={`tab-btn ${selectedType === '' ? 'active' : ''}`}
              onClick={() => setSelectedType('')}
            >
              All
            </button>
            <button
              className={`tab-btn ${selectedType === 'video' ? 'active' : ''}`}
              onClick={() => setSelectedType('video')}
            >
              Videos
            </button>
            <button
              className={`tab-btn ${selectedType === 'slideshow' ? 'active' : ''}`}
              onClick={() => setSelectedType('slideshow')}
            >
              Slideshows
            </button>
          </div>
        </div>
      </div>

      {/* Media Grid */}
      {posts.length === 0 ? (
        <div className="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
            <line x1="7" y1="2" x2="7" y2="22" />
            <line x1="17" y1="2" x2="17" y2="22" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="2" y1="7" x2="7" y2="7" />
            <line x1="2" y1="17" x2="7" y2="17" />
            <line x1="17" y1="17" x2="22" y2="17" />
            <line x1="17" y1="7" x2="22" y2="7" />
          </svg>
          <h3>No media downloaded yet</h3>
          <p>Add some profiles or trigger an on-demand download to populate your archive.</p>
        </div>
      ) : (
        <>
          <div className="media-grid">
            {posts.map((post) => (
              <button
                type="button"
                key={post.id}
                className="media-card"
                onClick={() => (post.type === 'video' ? setActiveVideo(post) : openSlideshow(post))}
              >
                <div className="media-thumbnail-wrapper">
                  <img
                    src={post.thumbnail_path ? `/media/${post.thumbnail_path}` : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23272530"%3E%3Crect width="24" height="24"/%3E%3C/svg%3E'}
                    alt={post.title}
                    className="media-thumbnail"
                    loading="lazy"
                  />
                  <span className={`media-badge badge-${post.type}`}>{post.type}</span>
                </div>
                
                <div className="media-info">
                  <span className="media-author">@{post.channel_id.replace(/^@/, '')}</span>
                  <h3 className="media-title" title={post.title || post.description}>
                    {post.title || post.description || 'TikTok Post'}
                  </h3>
                  <div className="media-footer">
                    <div className="media-date">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      {post.upload_date}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                className="btn btn-secondary"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <div className="pagination-label">
                Page {page} of {totalPages}
              </div>
              <button
                className="btn btn-secondary"
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Video Player Modal */}
      {activeVideo && (
        <div className="modal-overlay" onClick={() => setActiveVideo(null)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <button type="button" className="modal-close" onClick={() => setActiveVideo(null)} aria-label="Close video">x</button>
            <div className="video-wrapper">
              <video
                src={`/media/${activeVideo.file_path}`}
                controls
                autoPlay
                playsInline
              />
            </div>
            <div className="modal-body">
              <div className="modal-author-row">
                <span className="logo-text" style={{ fontSize: '1.25rem' }}>
                  @{activeVideo.channel_id.replace(/^@/, '')}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Posted: {activeVideo.upload_date}
                </span>
              </div>
              <p className="modal-desc">{activeVideo.description || activeVideo.title}</p>
            </div>
          </div>
        </div>
      )}

      {/* Slideshow Lightbox Modal */}
      {activeSlideshow && (
        <div className="modal-overlay" onClick={closeSlideshow}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '720px' }}>
            <button type="button" className="modal-close" onClick={closeSlideshow} aria-label="Close slideshow">x</button>
            
            <div className="slideshow-wrapper">
              {slideshowImages.length > 1 && (
                <button type="button" className="slide-nav-btn" onClick={prevSlide} aria-label="Previous slide">
                  &lt;
                </button>
              )}

              <div className="slide-container">
                {slideshowImages.length > 0 ? (
                  <img
                    src={`/media/${activeSlideshow.file_path}/${slideshowImages[currentSlideIndex]}`}
                    alt={`Slide ${currentSlideIndex + 1}`}
                    className="slide-image"
                  />
                ) : (
                  <div style={{ color: 'var(--text-secondary)' }}>Loading slides...</div>
                )}
              </div>

              {slideshowImages.length > 1 && (
                <button type="button" className="slide-nav-btn" onClick={nextSlide} aria-label="Next slide">
                  &gt;
                </button>
              )}

              {slideshowImages.length > 0 && (
                <div className="slide-counter">
                  {currentSlideIndex + 1} / {slideshowImages.length}
                </div>
              )}
            </div>

            <div className="modal-body">
              <div className="modal-author-row">
                <span className="logo-text" style={{ fontSize: '1.25rem' }}>
                  @{activeSlideshow.channel_id.replace(/^@/, '')}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Posted: {activeSlideshow.upload_date}
                </span>
              </div>
              <p className="modal-desc">{activeSlideshow.description || activeSlideshow.title}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
