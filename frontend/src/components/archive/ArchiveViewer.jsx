import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
  navigating,
  error,
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
  const dialogRef = useRef(null);
  const videoRef = useRef(null);
  const swipeStart = useRef(null);
  const activeThumbRef = useRef(null);

  const showPreviousSlide = useCallback(() => {
    if (slideCount > 1) {
      setSlideIndex((value) => (value - 1 + slideCount) % slideCount);
    }
  }, [setSlideIndex, slideCount]);

  const showNextSlide = useCallback(() => {
    if (slideCount > 1) {
      setSlideIndex((value) => (value + 1) % slideCount);
    }
  }, [setSlideIndex, slideCount]);

  const handleViewerPrevious = grouped && slideCount > 1 ? showPreviousSlide : onPrevious;
  const handleViewerNext = grouped && slideCount > 1 ? showNextSlide : onNext;
  const canViewerPrevious = grouped && slideCount > 1 ? true : canPrevious;
  const canViewerNext = grouped && slideCount > 1 ? true : canNext;

  useEffect(() => {
    if (slideIndex >= slideCount && slideCount > 0) setSlideIndex(0);
  }, [slideCount, slideIndex, setSlideIndex]);

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [slideIndex]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll('a[href], button:not([disabled]), audio[controls], video[controls], summary');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (event.key === 'ArrowLeft' && canViewerPrevious) handleViewerPrevious();
      if (event.key === 'ArrowRight' && canViewerNext) handleViewerNext();
      if (grouped && slideCount > 1 && event.key === 'ArrowUp') {
        event.preventDefault();
        showPreviousSlide();
      }
      if (grouped && slideCount > 1 && event.key === 'ArrowDown') {
        event.preventDefault();
        showNextSlide();
      }
      if (event.key === ' ' && activeMediaKind === 'video' && !['A', 'BUTTON', 'AUDIO', 'VIDEO'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        const video = videoRef.current;
        if (video) {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMediaKind, canViewerNext, canViewerPrevious, grouped, handleViewerNext, handleViewerPrevious, onClose, showNextSlide, showPreviousSlide, slideCount]);

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
    if (deltaX > 0 && canViewerPrevious) handleViewerPrevious();
    else if (deltaX < 0 && canViewerNext) handleViewerNext();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-container media-modal-container"
        role="dialog"
        aria-modal="true"
        aria-label={`Viewing ${post.title || post.description || 'archived media'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button ref={closeButtonRef} type="button" className="modal-close-btn" onClick={onClose} aria-label="Close viewer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
        <div className="media-player-layout">
          <div className="media-viewer-pane" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            <div className="viewer-context">
              <span role="status">{navigating ? 'Loading page…' : `${position} of ${pageSize}`}</span>
              <span className="viewer-shortcuts">← → browse · space play/pause · esc close</span>
            </div>
            <button
              type="button"
              className="nav-arrow-overlay prev-arrow"
              onClick={handleViewerPrevious}
              disabled={!canViewerPrevious}
              title={grouped && slideCount > 1 ? 'Previous slide (←)' : 'Previous post (←)'}
              aria-label={grouped && slideCount > 1 ? 'Previous slide' : 'Previous post'}
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
            <div className="media-modal-viewer">
              {loading ? (
                <div className="viewer-loading" role="status">Loading media…</div>
              ) : activeMediaKind === 'video' && activeMediaPath ? (
                <video
                  ref={videoRef}
                  key={activeMediaPath}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  poster={post.thumbnail_path ? `/media/${post.thumbnail_path}` : undefined}
                  src={`/media/${activeMediaPath}`}
                />
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
              disabled={!canViewerNext}
              title={grouped && slideCount > 1 ? 'Next slide (→)' : 'Next post (→)'}
              aria-label={grouped && slideCount > 1 ? 'Next slide' : 'Next post'}
            ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
            {grouped && slideCount > 0 ? (
              <div className="slideshow-controls" aria-label="Slideshow controls">
                <button type="button" className="slide-step-btn" onClick={showPreviousSlide} disabled={slideCount < 2} aria-label="Previous slide">‹</button>
                <span className="hud-slide-counter" aria-live="polite">{slideIndex + 1} / {slideCount}</span>
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
              <details className="post-stats-section">
                <summary>File details</summary>
                <div className="stat-row"><span className="stat-label">Upload Date</span><span className="stat-value">{post.upload_date || 'Unknown'}</span></div>
                <div className="stat-row"><span className="stat-label">Archived At</span><span className="stat-value">{formatDateTime(post.downloaded_at, 'Unknown')}</span></div>
                <div className="stat-row"><span className="stat-label">File Name</span><span className="stat-value file-path-text" title={post.file_path}>{post.file_path?.split('/').pop() || 'Unknown'}</span></div>
              </details>
            </div>
            <div className="info-pane-footer">
              {error ? <p className="alert danger" role="alert">{error}</p> : null}
              {!grouped ? (
                <a href={`/api/posts/${post.id}/download`} className="btn-action-primary download-action-btn" download>Download media</a>
              ) : activeMedia ? (
                <a href={`/api/posts/${post.id}/files/${activeMedia.index}/download`} className="btn-action-primary download-action-btn" download>Download file</a>
              ) : (
                <div className="slideshow-download-fallback-message">Media files are stored in: <code className="slide-dir-code">{post.file_path}</code></div>
              )}
              <div className="post-navigation">
                <button type="button" className="btn btn-secondary post-nav-btn" onClick={onPrevious} disabled={!canPrevious}>‹ Previous post</button>
                <button type="button" className="btn btn-secondary post-nav-btn" onClick={onNext} disabled={!canNext}>Next post ›</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
