import React, { useEffect, useMemo, useRef, useState } from 'react';
import { requestJson } from '../utils/api';
import { displaySource, fallbackThumb, isGroupedMedia, resolvePageNavigation } from '../utils/media';
import ArchiveFilters from './archive/ArchiveFilters';
import ArchiveViewer from './archive/ArchiveViewer';

const SKELETON_ITEMS = Array.from({ length: 12 }, (_, index) => index);

function MediaGlyph({ type }) {
  if (isGroupedMedia(type)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="4" y="5" width="14" height="14" rx="2" />
        <path d="m8 14 2.5-2.5 2 2 1.5-1.5 4 4M8 8.5h.01M20 8v10a3 3 0 0 1-3 3H8" />
      </svg>
    );
  }
  if (type === 'audio') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 18V6l10-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></svg>;
  }
  if (type === 'image') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 16 3-3 2 2 3-4 4 5M8 8h.01" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m9 7 8 5-8 5V7Z" /></svg>;
}

function DownloadGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>;
}

export default function MediaBrowser({ onNavigateToDownload }) {
  const [posts, setPosts] = useState([]);
  const [channels, setChannels] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadedPage, setLoadedPage] = useState(0);
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
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const openRequestId = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const activePostIndex = activePost
    ? posts.findIndex((post) => post.id === activePost.id)
    : -1;
  const canNavigatePrevious = !pendingNavigation && activePostIndex >= 0
    && (activePostIndex > 0 || page > 1);
  const canNavigateNext = !pendingNavigation && activePostIndex >= 0
    && (activePostIndex < posts.length - 1 || page < totalPages);
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
      missing_thumbnail: missingThumbnail ? '1' : '',
    });
    return params.toString();
  }, [page, limit, sort, direction, search, selectedChannels, selectedType, dateFrom, dateTo, missingThumbnail]);

  const openPost = async (post) => {
    const requestId = openRequestId.current + 1;
    openRequestId.current = requestId;
    setActivePost(post);
    setMediaFiles([]);
    setSlideIndex(0);
    setMediaLoading(isGroupedMedia(post.type));
    if (!isGroupedMedia(post.type)) return;
    try {
      const data = await requestJson(`/api/posts/${post.id}`, {}, 'Failed to load media files');
      if (requestId !== openRequestId.current) return;
      setMediaFiles(data.media || []);
    } catch (requestError) {
      if (requestId !== openRequestId.current) return;
      setError(requestError.message);
    } finally {
      if (requestId === openRequestId.current) setMediaLoading(false);
    }
  };

  const closePost = () => {
    openRequestId.current += 1;
    setPendingNavigation(null);
    setActivePost(null);
    setMediaFiles([]);
    setMediaLoading(false);
  };

  const handlePrevious = () => {
    if (!activePost || pendingNavigation) return;
    const index = posts.findIndex((post) => post.id === activePost.id);
    if (index > 0) void openPost(posts[index - 1]);
    else if (page > 1) {
      const targetPage = page - 1;
      setPendingNavigation({ edge: 'last', page: targetPage });
      setPage(targetPage);
    }
  };

  const handleNext = () => {
    if (!activePost || pendingNavigation) return;
    const index = posts.findIndex((post) => post.id === activePost.id);
    if (index < posts.length - 1) void openPost(posts[index + 1]);
    else if (page < totalPages) {
      const targetPage = page + 1;
      setPendingNavigation({ edge: 'first', page: targetPage });
      setPage(targetPage);
    }
  };

  useEffect(() => {
    let current = true;
    setError('');
    setLoading(true);
    requestJson(`/api/posts?${queryString}`, {}, 'Failed to load archive')
      .then((data) => {
        if (!current) return;
        setPosts(data.posts || []);
        setTotal(data.total || 0);
        setLoadedPage(page);
      })
      .catch((requestError) => {
        if (current) {
          setError(requestError.message);
          setPendingNavigation(null);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [page, queryString]);

  useEffect(() => {
    let current = true;
    requestJson('/api/channels', {}, 'Failed to load profiles')
      .then((data) => {
        if (current) setChannels(Array.isArray(data) ? data : []);
      })
      .catch((requestError) => {
        if (current) setError(requestError.message);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    const nextPost = resolvePageNavigation(pendingNavigation, loadedPage, posts);
    if (!nextPost) return;
    void openPost(nextPost);
    setPendingNavigation(null);
  }, [loadedPage, pendingNavigation, posts]);

  useEffect(() => {
    setPage(1);
  }, [search, selectedChannels, selectedType, sort, direction, dateFrom, dateTo, missingThumbnail, limit]);

  const toggleChannel = (id) => {
    setSelectedChannels((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const clearFilters = () => {
    setSearch('');
    setSelectedChannels([]);
    setSelectedType('');
    setSort('upload_date');
    setDirection('desc');
    setDateFrom('');
    setDateTo('');
    setMissingThumbnail(false);
    setPage(1);
  };

  return (
    <div className="archive-console">
      {error ? <div className="alert danger">{error}</div> : null}
      <ArchiveFilters
        search={search}
        setSearch={setSearch}
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        selectedType={selectedType}
        setSelectedType={setSelectedType}
        selectedChannels={selectedChannels}
        toggleChannel={toggleChannel}
        channels={channels}
        sort={sort}
        setSort={setSort}
        direction={direction}
        setDirection={setDirection}
        limit={limit}
        setLimit={setLimit}
        missingThumbnail={missingThumbnail}
        setMissingThumbnail={setMissingThumbnail}
        dateFrom={dateFrom}
        setDateFrom={setDateFrom}
        dateTo={dateTo}
        setDateTo={setDateTo}
        density={density}
        setDensity={setDensity}
        clearFilters={clearFilters}
      />

      <div className="archive-results-meta" aria-live="polite">
        <span>{loading ? 'Updating archive…' : `${total.toLocaleString()} archived item${total === 1 ? '' : 's'}`}</span>
        <span>Page {page} of {totalPages}</span>
      </div>

      {loading ? (
        <div className={`media-grid density-${density}`} aria-label="Loading archive" aria-busy="true">
          {SKELETON_ITEMS.map((item) => (
            <div className="media-card media-card-skeleton" key={item} aria-hidden="true">
              <span className="skeleton-thumbnail" />
              <span className="skeleton-copy"><i /><i /><i /></span>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="empty-state archive-empty-state">
          <span className="empty-state-icon"><MediaGlyph type="video" /></span>
          <h2>No media found</h2>
          <p>Try clearing the current filters, or add a TikTok link to start filling your private archive.</p>
          <div className="empty-state-actions">
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>
            {onNavigateToDownload ? <button type="button" className="btn btn-primary" onClick={onNavigateToDownload}>Add a download</button> : null}
          </div>
        </div>
      ) : (
        <div className={`media-grid density-${density}`}>
          {posts.map((post) => (
            <article key={post.id} className="media-card">
              <button type="button" className="media-open" onClick={() => void openPost(post)}>
                <span className="media-thumbnail-wrapper">
                  <img
                    src={post.thumbnail_path ? `/media/${post.thumbnail_path}` : fallbackThumb(post.type)}
                    alt={post.title || post.description || post.id}
                    className="media-thumbnail"
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.src = fallbackThumb(post.type);
                    }}
                  />
                  <span className="media-open-glyph"><MediaGlyph type={post.type} /></span>
                  <span className={`media-badge ${post.type}`}>{post.type}</span>
                </span>
                <span className="media-info">
                  <span className="media-author">{displaySource(post.channel_id)}</span>
                  <strong>{post.title || post.description || 'Untitled media'}</strong>
                  <span className="media-meta"><span>{post.upload_date || 'Date unknown'}</span><span>Archived {post.downloaded_at?.slice(0, 10) || 'unknown'}</span></span>
                </span>
              </button>
              {!isGroupedMedia(post.type) ? (
                <a className="card-download-btn visible" href={`/api/posts/${post.id}/download`} title="Download media" aria-label={`Download ${post.title || post.description || 'media'}`} download><DownloadGlyph /></a>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="pagination-controls" aria-label="Archive pages">
          <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <span className="pagination-label">{page} / {totalPages}</span>
          <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
        </nav>
      ) : null}

      {activePost ? (
        <ArchiveViewer
          post={activePost}
          mediaFiles={mediaFiles}
          loading={mediaLoading}
          slideIndex={slideIndex}
          setSlideIndex={setSlideIndex}
          onClose={closePost}
          onPrevious={handlePrevious}
          onNext={handleNext}
          canPrevious={canNavigatePrevious}
          canNext={canNavigateNext}
          position={Math.max(1, ((page - 1) * limit) + activePostIndex + 1)}
          pageSize={total}
        />
      ) : null}
    </div>
  );
}
