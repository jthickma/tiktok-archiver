import React, { useEffect, useMemo, useState } from 'react';
import { requestJson } from '../utils/api';
import { displaySource, fallbackThumb, isGroupedMedia } from '../utils/media';
import ArchiveFilters from './archive/ArchiveFilters';
import ArchiveViewer from './archive/ArchiveViewer';

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
  const [mediaFiles, setMediaFiles] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

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
      missing_thumbnail: missingThumbnail ? '1' : '',
    });
    return params.toString();
  }, [page, limit, sort, direction, search, selectedChannels, selectedType, dateFrom, dateTo, missingThumbnail]);

  const openPost = async (post) => {
    setActivePost(post);
    setMediaFiles([]);
    setSlideIndex(0);
    if (!isGroupedMedia(post.type)) return;
    try {
      const data = await requestJson(`/api/posts/${post.id}`, {}, 'Failed to load media files');
      setMediaFiles(data.media || []);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handlePrevious = () => {
    if (!activePost) return;
    const index = posts.findIndex((post) => post.id === activePost.id);
    if (index > 0) void openPost(posts[index - 1]);
    else if (page > 1) {
      setPendingNavigation('last');
      setPage((value) => value - 1);
    }
  };

  const handleNext = () => {
    if (!activePost) return;
    const index = posts.findIndex((post) => post.id === activePost.id);
    if (index < posts.length - 1) void openPost(posts[index + 1]);
    else if (page < totalPages) {
      setPendingNavigation('first');
      setPage((value) => value + 1);
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
      })
      .catch((requestError) => {
        if (current) setError(requestError.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [queryString]);

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
    if (!pendingNavigation || posts.length === 0) return;
    void openPost(pendingNavigation === 'first' ? posts[0] : posts.at(-1));
    setPendingNavigation(null);
  }, [posts, pendingNavigation]);

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

      <div className="bulk-bar">
        <span>{loading ? 'Loading archive...' : `${total} items`}</span>
        <span>Page {page} of {totalPages}</span>
      </div>

      {loading ? (
        <div className="empty-state">Loading archived media...</div>
      ) : posts.length === 0 ? (
        <div className="empty-state">No archived media matches this view.</div>
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
                  <span className={`media-badge ${post.type}`}>{post.type}</span>
                </span>
                <span className="media-info">
                  <span className="media-author">{displaySource(post.channel_id)}</span>
                  <strong>{post.title || post.description || 'Untitled media'}</strong>
                  <span className="media-meta">{post.upload_date || 'No date'} / downloaded {post.downloaded_at?.slice(0, 10) || 'unknown'}</span>
                </span>
              </button>
              {!isGroupedMedia(post.type) ? (
                <a className="card-download-btn visible" href={`/api/posts/${post.id}/download`} title="Download media" aria-label="Download media" download>↓</a>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <div className="pagination-controls">
        <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
        <span className="pagination-label">Page {page} of {totalPages}</span>
        <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
      </div>

      {activePost ? (
        <ArchiveViewer
          post={activePost}
          mediaFiles={mediaFiles}
          slideIndex={slideIndex}
          setSlideIndex={setSlideIndex}
          onClose={() => setActivePost(null)}
          onPrevious={handlePrevious}
          onNext={handleNext}
          position={posts.findIndex((post) => post.id === activePost.id) + 1}
          pageSize={posts.length}
        />
      ) : null}
    </div>
  );
}
