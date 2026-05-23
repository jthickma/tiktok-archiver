import React, { useState, useEffect, useRef } from 'react';

// Premium Custom HTML5 Video Player
function CustomVideoPlayer({ video, onNext, onPrev, onClose }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1); // 0 to 1
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [flash, setFlash] = useState({ active: false, icon: '' });

  // Auto-hide controls timeout
  useEffect(() => {
    let timeout;
    const handleMouseMove = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (isPlaying) {
          setShowControls(false);
        }
      }, 2500);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mousemove', handleMouseMove);
    }
    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleMouseMove);
      }
      clearTimeout(timeout);
    };
  }, [isPlaying]);

  // Sync volume & mute on video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  const triggerFlash = (icon) => {
    setFlash({ active: true, icon });
    setTimeout(() => setFlash({ active: false, icon: '' }), 500);
  };

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
      triggerFlash('▶');
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      triggerFlash('⏸');
    }
  };

  const handleSeek = (e) => {
    if (!videoRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    videoRef.current.currentTime = percentage * duration;
  };

  const handleVolumeClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    setVolume(percentage);
    setIsMuted(percentage === 0);
  };

  const toggleMute = () => {
    const newMute = !isMuted;
    setIsMuted(newMute);
    triggerFlash(newMute ? '🔇' : '🔊');
  };

  const handleSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setShowSpeedMenu(false);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => console.error('Fullscreen request error:', err));
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      }).catch((err) => console.error('Fullscreen exit error:', err));
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Keyboard Shortcuts in Modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'arrowright':
        case 'l':
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 5);
            triggerFlash('⏩');
          }
          break;
        case 'arrowleft':
        case 'j':
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
            triggerFlash('⏪');
          }
          break;
        case 'arrowup':
          e.preventDefault();
          setVolume((v) => Math.min(1, v + 0.1));
          break;
        case 'arrowdown':
          e.preventDefault();
          setVolume((v) => Math.max(0, v - 0.1));
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'n':
          e.preventDefault();
          onNext();
          break;
        case 'p':
          e.preventDefault();
          onPrev();
          break;
        case 'escape':
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            onClose();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [duration, isMuted, volume, onNext, onPrev, onClose]);

  const formatTime = (timeInSecs) => {
    if (isNaN(timeInSecs)) return '0:00';
    const mins = Math.floor(timeInSecs / 60);
    const secs = Math.floor(timeInSecs % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <div ref={containerRef} className="custom-video-player">
      <div className={`player-flash ${flash.active ? 'active' : ''}`}>
        <span style={{ fontSize: '1.75rem', fontWeight: 800 }}>{flash.icon}</span>
      </div>

      <video
        ref={videoRef}
        src={`/media/${video.file_path}`}
        autoPlay
        playsInline
        onClick={handlePlayPause}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
      />

      <div className={`player-controls ${showControls || !isPlaying ? 'visible' : ''}`}>
        <div className="player-timeline-container" onClick={handleSeek}>
          <div className="player-timeline">
            <div
              className="player-progress"
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />
            <div
              className="player-scrubber"
              style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>
        </div>

        <div className="player-buttons-row">
          <div className="player-controls-group">
            <button type="button" className="player-btn" onClick={handlePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <div className="player-volume-wrapper">
              <button type="button" className="player-btn" onClick={toggleMute} title="Mute/Unmute">
                {isMuted || volume === 0 ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : volume < 0.5 ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L9 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                )}
              </button>

              <div className="player-volume-slider-container">
                <div className="player-volume-slider" onClick={handleVolumeClick} title="Volume">
                  <div
                    className="player-volume-progress"
                    style={{ width: `${isMuted ? 0 : volume * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <span className="player-time-display">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="player-controls-group">
            <a
              href={`/api/posts/${video.id}/download`}
              className="player-btn"
              title="Download Video File"
              download
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
              </svg>
            </a>

            <div className="player-speed-wrapper">
              <button
                type="button"
                className="player-btn"
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                title="Playback Speed"
                style={{ fontSize: '0.8rem', fontWeight: 800 }}
              >
                {playbackSpeed}x
              </button>

              {showSpeedMenu && (
                <div className="player-speed-menu">
                  {[0.5, 1, 1.25, 1.5, 2].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`player-speed-item ${playbackSpeed === s ? 'active' : ''}`}
                      onClick={() => handleSpeedChange(s)}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button type="button" className="player-btn" onClick={toggleFullscreen} title="Fullscreen (F)">
              {isFullscreen ? (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

  // ZIP Downloader & Toast States
  const [isZipping, setIsZipping] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: '' });
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

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

  // Unified Next/Prev Post Navigation
  const navigateToPost = (direction) => {
    const currentPost = activeVideo || activeSlideshow;
    if (!currentPost || posts.length === 0) return;

    const currentIndex = posts.findIndex((p) => p.id === currentPost.id);
    if (currentIndex === -1) return;

    let newIndex = 0;
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % posts.length;
    } else {
      newIndex = (currentIndex - 1 + posts.length) % posts.length;
    }

    const newPost = posts[newIndex];
    if (newPost.type === 'video') {
      setActiveSlideshow(null);
      setSlideshowImages([]);
      setCurrentSlideIndex(0);
      setActiveVideo(newPost);
    } else {
      setActiveVideo(null);
      openSlideshow(newPost);
    }
  };

  // Keyboard navigation for slideshow and post navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!activeSlideshow) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowRight') {
        nextSlide();
      } else if (e.key === 'ArrowLeft') {
        prevSlide();
      } else if (e.key.toLowerCase() === 'n') {
        navigateToPost('next');
      } else if (e.key.toLowerCase() === 'p') {
        navigateToPost('prev');
      } else if (e.key === 'Escape') {
        closeSlideshow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSlideshow, slideshowImages, currentSlideIndex, posts]);

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

  // Download Profile / Entire Archive as ZIP
  const handleDownloadZip = (channelId = '') => {
    setIsZipping(true);
    setToast({
      show: true,
      message: channelId
        ? `Compiling ZIP archive for ${channelId}... Preparing files...`
        : 'Compiling ZIP for all archived profiles... Preparing files...',
      type: 'info'
    });

    const url = `/api/posts/zip${channelId ? `?channel_id=${encodeURIComponent(channelId)}` : ''}`;
    
    try {
      window.location.href = url;
      
      setTimeout(() => {
        setToast({
          show: true,
          message: 'ZIP compiled! Download starting automatically.',
          type: 'success'
        });
        setTimeout(() => setToast({ show: false, message: '', type: '' }), 4000);
      }, 3500);
    } catch (err) {
      console.error(err);
      setToast({
        show: true,
        message: 'Failed to compile ZIP archive. Check server status.',
        type: 'danger'
      });
      setTimeout(() => setToast({ show: false, message: '', type: '' }), 4000);
    } finally {
      setIsZipping(false);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Toast Notification */}
      {toast.show && (
        <div className={`toast-notification ${toast.type}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {toast.message}
        </div>
      )}

      {/* Shortcuts Helper Dialog */}
      {showShortcutsHelp && (
        <div className="shortcuts-modal-overlay" onClick={() => setShowShortcutsHelp(false)}>
          <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="shortcuts-title">Keyboard Shortcuts</h3>
            <div className="shortcuts-grid">
              <span className="shortcut-key">Space / K</span>
              <span className="shortcut-desc">Play / Pause Video</span>
              
              <span className="shortcut-key">← / J</span>
              <span className="shortcut-desc">Seek backward 5s / Prev Slide</span>
              
              <span className="shortcut-key">→ / L</span>
              <span className="shortcut-desc">Seek forward 5s / Next Slide</span>
              
              <span className="shortcut-key">↑</span>
              <span className="shortcut-desc">Increase Volume</span>
              
              <span className="shortcut-key">↓</span>
              <span className="shortcut-desc">Decrease Volume</span>
              
              <span className="shortcut-key">M</span>
              <span className="shortcut-desc">Mute / Unmute</span>
              
              <span className="shortcut-key">F</span>
              <span className="shortcut-desc">Toggle Fullscreen</span>
              
              <span className="shortcut-key">N</span>
              <span className="shortcut-desc">Next post in archive</span>
              
              <span className="shortcut-key">P</span>
              <span className="shortcut-desc">Previous post in archive</span>
              
              <span className="shortcut-key">Esc</span>
              <span className="shortcut-desc">Close player / Exit Fullscreen</span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '1rem' }}
              onClick={() => setShowShortcutsHelp(false)}
            >
              Close Guide
            </button>
          </div>
        </div>
      )}

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
          {/* Dynamic Profile Zip Exporter */}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isZipping || posts.length === 0}
            onClick={() => handleDownloadZip(selectedChannel)}
            title={selectedChannel ? `Download ZIP of @${selectedChannel.replace(/^@/, '')}'s videos` : 'Download ZIP of all archived videos'}
            style={{ minHeight: '40px', padding: '0.5rem 1rem' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '0.25rem' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {selectedChannel ? 'Zip Profile' : 'Zip All'}
          </button>

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
                  
                  {/* Card Direct Download Button */}
                  <a
                    href={`/api/posts/${post.id}/download`}
                    className="card-download-btn"
                    title="Download Media File"
                    download
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
                    </svg>
                  </a>
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
          {/* Unified side navigators */}
          {posts.length > 1 && (
            <>
              <button
                type="button"
                className="modal-nav-btn prev"
                onClick={(e) => { e.stopPropagation(); navigateToPost('prev'); }}
                aria-label="Previous video"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                type="button"
                className="modal-nav-btn next"
                onClick={(e) => { e.stopPropagation(); navigateToPost('next'); }}
                aria-label="Next video"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </>
          )}

          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px' }}>
            <button type="button" className="modal-close" onClick={() => setActiveVideo(null)} aria-label="Close video">x</button>
            
            <div className="video-wrapper">
              <CustomVideoPlayer
                video={activeVideo}
                onNext={() => navigateToPost('next')}
                onPrev={() => navigateToPost('prev')}
                onClose={() => setActiveVideo(null)}
              />
            </div>
            
            <div className="modal-body">
              <div className="modal-author-row">
                <span className="logo-text" style={{ fontSize: '1.25rem' }}>
                  @{activeVideo.channel_id.replace(/^@/, '')}
                </span>
                <button
                  type="button"
                  className="shortcuts-help-btn"
                  onClick={() => setShowShortcutsHelp(true)}
                >
                  Shortcuts Guide
                </button>
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
          {/* Unified side navigators */}
          {posts.length > 1 && (
            <>
              <button
                type="button"
                className="modal-nav-btn prev"
                onClick={(e) => { e.stopPropagation(); navigateToPost('prev'); }}
                aria-label="Previous slide post"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                type="button"
                className="modal-nav-btn next"
                onClick={(e) => { e.stopPropagation(); navigateToPost('next'); }}
                aria-label="Next slide post"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </>
          )}

          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '720px' }}>
            <button type="button" className="modal-close" onClick={closeSlideshow} aria-label="Close slideshow">x</button>
            
            <div className="slideshow-wrapper">
              {slideshowImages.length > 1 && (
                <button type="button" className="slide-nav-btn" onClick={(e) => { e.stopPropagation(); prevSlide(); }} aria-label="Previous slide">
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
                <button type="button" className="slide-nav-btn" onClick={(e) => { e.stopPropagation(); nextSlide(); }} aria-label="Next slide">
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
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <a
                    href={`/api/posts/${activeSlideshow.id}/download`}
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', minHeight: '32px' }}
                    download
                  >
                    Download ZIP
                  </a>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Posted: {activeSlideshow.upload_date}
                  </span>
                </div>
              </div>
              <p className="modal-desc">{activeSlideshow.description || activeSlideshow.title}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
