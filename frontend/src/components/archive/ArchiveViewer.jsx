import React, { useEffect } from 'react';
import { formatDateTime } from '../../utils/format';
import {
  avatarText,
  displaySource,
  getAvatarColor,
  isGroupedMedia,
} from '../../utils/media';

export default function ArchiveViewer({
  post,
  mediaFiles,
  slideIndex,
  setSlideIndex,
  onClose,
  onPrevious,
  onNext,
  position,
  pageSize,
}) {
  const activeMedia = mediaFiles[slideIndex];
  const activeMediaPath = activeMedia?.path || post.file_path;
  const activeMediaKind = activeMedia?.kind || post.type;
  const grouped = isGroupedMedia(post.type);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onPrevious();
      if (event.key === 'ArrowRight') onNext();
      if (grouped && mediaFiles.length > 1 && event.key === 'ArrowUp') {
        event.preventDefault();
        setSlideIndex((value) => (value - 1 + mediaFiles.length) % mediaFiles.length);
      }
      if (grouped && mediaFiles.length > 1 && event.key === 'ArrowDown') {
        event.preventDefault();
        setSlideIndex((value) => (value + 1) % mediaFiles.length);
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
  }, [activeMediaKind, grouped, mediaFiles.length, onClose, onNext, onPrevious, setSlideIndex]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container media-modal-container" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        <div className="media-player-layout">
          <div className="media-viewer-pane">
            <button type="button" className="nav-arrow-overlay prev-arrow" onClick={onPrevious} title="Previous media (←)" aria-label="Previous media">‹</button>
            <div className="media-modal-viewer">
              {activeMediaKind === 'video' ? (
                <video controls autoPlay playsInline src={`/media/${activeMediaPath}`} />
              ) : activeMediaKind === 'audio' ? (
                <div className="slideshow-view"><audio controls autoPlay src={`/media/${activeMediaPath}`} /></div>
              ) : activeMediaPath ? (
                <div className="slideshow-view">
                  <img src={`/media/${activeMediaPath}`} alt={activeMedia?.name || post.title || post.id} />
                  {mediaFiles.length > 1 ? (
                    <div className="slide-indicator-pills">
                      {mediaFiles.map((item, index) => (
                        <button
                          key={item.path}
                          type="button"
                          className={`slide-indicator-dot ${index === slideIndex ? 'active' : ''}`}
                          onClick={() => setSlideIndex(index)}
                          title={`Go to media ${index + 1}`}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : <div className="empty-state">No media files found.</div>}
            </div>
            <button type="button" className="nav-arrow-overlay next-arrow" onClick={onNext} title="Next media (→)" aria-label="Next media">›</button>
            {grouped && mediaFiles.length > 1 ? (
              <div className="slideshow-hud-controls">
                <button type="button" className="hud-slide-btn prev-slide" onClick={() => setSlideIndex((slideIndex - 1 + mediaFiles.length) % mediaFiles.length)}>▲</button>
                <span className="hud-slide-counter">{slideIndex + 1} / {mediaFiles.length}</span>
                <button type="button" className="hud-slide-btn next-slide" onClick={() => setSlideIndex((slideIndex + 1) % mediaFiles.length)}>▼</button>
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
              <div className="mobile-only-control-bar">
                <button type="button" className="btn btn-secondary mobile-nav-btn" onClick={onPrevious}>◀ Prev</button>
                <span className="mobile-nav-page-indicator">{position} / {pageSize}</span>
                <button type="button" className="btn btn-secondary mobile-nav-btn" onClick={onNext}>Next ▶</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
