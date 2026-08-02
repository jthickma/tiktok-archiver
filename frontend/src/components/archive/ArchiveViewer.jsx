import React, { useEffect, useMemo, useRef } from 'react';
import { formatDateTime } from '../../utils/format';
import {
  avatarText,
  displaySource,
  getAvatarColor,
  isGroupedMedia,
  partitionGroupedMedia,
} from '../../utils/media';

export default function ArchiveViewer({
  post,
  mediaFiles,
  loading,
  slideIndex,
  setSlideIndex,
  onClose,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  position,
  pageSize,
}) {
  const grouped = isGroupedMedia(post.type);
  const { slides, audioTracks } = useMemo(
    () => (grouped
      ? partitionGroupedMedia(mediaFiles)
      : { slides: mediaFiles, audioTracks: [] }),
    [grouped, mediaFiles],
  );
  const slideCount = slides.length;
  const activeMedia = grouped ? slides[slideIndex] : mediaFiles[0];
  const activeMediaPath = grouped ? activeMedia?.path : activeMedia?.path || post.file_path;
  const activeMediaKind = grouped ? activeMedia?.kind : activeMedia?.kind || post.type;
  const closeButtonRef = useRef(null);
  const swipeStart = useRef(null);
  const activeThumbRef = useRef(null);

  const showPreviousSlide = () => {
    if (slideCount > 1) {
      setSlideIndex((value) => (value - 1 + slideCount) % slideCount);
    }
  };

  const showNextSlide = () => {
    if (slideCount > 1) {
      setSlideIndex((value) => (value + 1) % slideCount);
    }
  };

  const handleViewerPrevious = grouped && slideCount > 1 ? showPreviousSlide : onPrevious;
  const handleViewerNext = grouped && slideCount > 1 ? showNextSlide : onNext;

  useEffect(() => {
    if (slideIndex >= slideCount && slideCount > 0) setSlideIndex(0);
  }, [slideCount, slideIndex, setSlideIndex]);

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [slideIndex]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (event.key === 'ArrowLeft') handleViewerPrevious();
      if (event.key === 'ArrowRight') handleViewerNext();
      if (grouped && slideCount > 1 && event.key === 'ArrowUp') {
        event.preventDefault();
        showPreviousSlide();
      }
      if (grouped && slideCount > 1 && event.key === 'ArrowDown') {
        event.preventDefault();
        showNextSlide();
      }
      if (event.key === ' ' && activeMediaKind === 'video') {
        event.preventDefault();
        const video = document.querySelector('.media-modal-viewer video');
        if (video) {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMediaKind, grouped, onClose, onNext, onPrevious, slideCount]);

  const handleTouchStart = (event) => {
    if (event.target.closest('button, a, audio, video')) {
      swipeStart.current = null;
      return;
    }
    const touch = event.changedTouches[0];
    swipeStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event) => {
    if (!swipeStart.current) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - swipeStart.current.x;
    const deltaY = touch.clientY - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    if (deltaX > 0) handleViewerPrevious();
    else handleViewerNext();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-container media-modal-container"
        role="dialog"
        aria-modal="true"
        aria-label={`Viewing ${post.title || post.description || 'archived media'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button ref={closeButtonRef} type="button" className="modal-close-btn" onClick={onClose} aria-label="Close viewer">✕</button>
        <div className="media-player-layout">
          <div className="media-viewer-pane" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            <button
              type="button"
              className="nav-arrow-overlay prev-arrow"
              onClick={handleViewerPrevious}
              disabled={!grouped && !canPrevious}
              title={grouped && slideCount > 1 ? 'Previous slide (←)' : 'Previous post (←)'}
              aria-label={grouped && slideCount > 1 ? 'Previous slide' : 'Previous post'}
            >‹</button>
            <div className="media-modal-viewer">
              {loading ? (
                <div className="viewer-loading" role="status">Loading media…</div>
              ) : activeMediaKind === 'video' && activeMediaPath ? (
                <video controls autoPlay playsInline src={`/media/${activeMediaPath}`} />
              ) : activeMediaKind === 'audio' && activeMediaPath ? (
                <div className="audio-only-view">
                  <span>Audio</span>
                  <audio controls src={`/media/${activeMediaPath}`} />
                </div>
              ) : activeMediaPath ? (
                <div className="slideshow-view">
                  <img src={`/media/${activeMediaPath}`} alt={activeMedia?.name || post.title || post.id} />
                </div>
              ) : <div className="viewer-empty">No viewable media files found.</div>}
            </div>
            <button
              type="button"
              className="nav-arrow-overlay next-arrow"
              onClick={handleViewerNext}
              disabled={!grouped && !canNext}
              title={grouped && slideCount > 1 ? 'Next slide (→)' : 'Next post (→)'}
              aria-label={grouped && slideCount > 1 ? 'Next slide' : 'Next post'}
            >›</button>
            {grouped && slideCount > 1 ? (
              <div className="slideshow-controls" aria-label="Slideshow controls">
                <button type="button" className="slide-step-btn" onClick={showPreviousSlide} disabled={slideCount < 2} aria-label="Previous slide">‹</button>
                <span className="hud-slide-counter">{slideIndex + 1} / {slideCount}</span>
                <button type="button" className="slide-step-btn" onClick={showNextSlide} disabled={slideCount < 2} aria-label="Next slide">›</button>
              </div>
            ) : null}
          </div>

          <div className="media-info-pane">
            <div className="info-pane-header">
              <div className="author-badge-container">
                <div className="author-avatar-circle" style={{ background: getAvatarColor(post.channel_id) }}>
                  {avatarText(post.channel_id)}
                </div>
                <div className="author-meta-text">
                  <span className="author-username">{displaySource(post.channel_id)}</span>
                  <span className="post-type-badge">{post.type}</span>
                </div>
              </div>
            </div>
            <div className="info-pane-body">
              {grouped && slideCount > 1 ? (
                <div className="slide-strip" aria-label="Choose a slide">
                  {slides.map((item, index) => (
                    <button
                      key={item.path}
                      ref={index === slideIndex ? activeThumbRef : null}
                      type="button"
                      className={index === slideIndex ? 'active' : ''}
                      onClick={() => setSlideIndex(index)}
                      aria-label={`Show slide ${index + 1}`}
                      aria-current={index === slideIndex ? 'true' : undefined}
                    >
                      {item.kind === 'image'
                        ? <img src={`/media/${item.path}`} alt="" loading="lazy" />
                        : <span className="slide-video-label">Video</span>}
                      <span>{index + 1}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {audioTracks.length > 0 ? (
                <div className="soundtrack-section">
                  <div>
                    <span className="soundtrack-label">Soundtrack</span>
                    <span className="soundtrack-name">{audioTracks[0].name}</span>
                  </div>
                  <audio controls preload="metadata" src={`/media/${audioTracks[0].path}`} />
                </div>
              ) : null}
              <div className="post-caption-section">
                <h3 className="caption-heading">Caption</h3>
                <p className="post-caption-text">{post.description || post.title || 'No caption available'}</p>
              </div>
              <div className="post-stats-section">
                <div className="stat-row"><span className="stat-label">Upload Date</span><span className="stat-value">{post.upload_date || 'Unknown'}</span></div>
                <div className="stat-row"><span className="stat-label">Archived At</span><span className="stat-value">{formatDateTime(post.downloaded_at, 'Unknown')}</span></div>
                <div className="stat-row"><span className="stat-label">File Name</span><span className="stat-value file-path-text" title={post.file_path}>{post.file_path?.split('/').pop() || 'Unknown'}</span></div>
              </div>
            </div>
            <div className="info-pane-footer">
              {!grouped ? (
                <a href={`/api/posts/${post.id}/download`} className="btn-action-primary download-action-btn" download>Download media</a>
              ) : activeMedia ? (
                <a href={`/api/posts/${post.id}/files/${activeMedia.index}/download`} className="btn-action-primary download-action-btn" download>Download file</a>
              ) : (
                <div className="slideshow-download-fallback-message">Media files are stored in: <code className="slide-dir-code">{post.file_path}</code></div>
              )}
              <div className="post-navigation">
                <button type="button" className="btn btn-secondary post-nav-btn" onClick={onPrevious} disabled={!canPrevious}>‹ Previous post</button>
                <span className="post-position">{position} / {pageSize}</span>
                <button type="button" className="btn btn-secondary post-nav-btn" onClick={onNext} disabled={!canNext}>Next post ›</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
