import React from 'react';

const MEDIA_TYPES = ['', 'video', 'slideshow', 'image', 'gallery', 'audio'];
const DENSITIES = ['dense', 'compact', 'wide'];

export default function ArchiveFilters({
  search,
  setSearch,
  filtersOpen,
  setFiltersOpen,
  selectedType,
  setSelectedType,
  selectedChannels,
  toggleChannel,
  channels,
  sort,
  setSort,
  direction,
  setDirection,
  limit,
  setLimit,
  missingThumbnail,
  setMissingThumbnail,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  density,
  setDensity,
  clearFilters,
}) {
  const hasFilters =
    selectedType ||
    selectedChannels.length ||
    dateFrom ||
    dateTo ||
    missingThumbnail;

  return (
    <>
      <div className="toolbar">
        <label className="archive-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            className="text-input search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your archive"
            aria-label="Search archive"
          />
        </label>
        <button
          type="button"
          className={`btn btn-secondary mobile-filter-toggle ${filtersOpen ? 'active' : ''}`}
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
        >
          Filters
          {hasFilters ? <span className="filter-count">•</span> : null}
        </button>
      </div>

      <div className={`archive-filters ${filtersOpen ? 'open' : ''}`}>
        <div className="filter-dock">
          <div className="segmented-control media-type-filter">
            {MEDIA_TYPES.map((type) => (
              <button key={type || 'all'} type="button" className={selectedType === type ? 'active' : ''} onClick={() => setSelectedType(type)}>
                {type || 'all'}
              </button>
            ))}
          </div>
          <select className="select-input" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort archive">
            <option value="upload_date">Upload date</option>
            <option value="downloaded_at">Download date</option>
            <option value="profile">Profile</option>
            <option value="type">Type</option>
            <option value="title">Title</option>
          </select>
          <button type="button" className="icon-btn" onClick={() => setDirection((value) => value === 'desc' ? 'asc' : 'desc')} title="Toggle sort direction">
            {direction === 'desc' ? 'Newest first' : 'Oldest first'}
          </button>
          <select className="select-input" value={limit} onChange={(event) => setLimit(Number(event.target.value))} aria-label="Items per page">
            {[24, 36, 60, 100].map((value) => <option key={value} value={value}>{value} per page</option>)}
          </select>
          <label className="check-pill">
            <input type="checkbox" checked={missingThumbnail} onChange={(event) => setMissingThumbnail(event.target.checked)} />
            Missing thumbnail
          </label>
          <input className="date-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Start date" />
          <input className="date-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="End date" />
          <div className="segmented-control density-control">
            {DENSITIES.map((mode) => (
              <button key={mode} type="button" className={density === mode ? 'active' : ''} onClick={() => setDensity(mode)}>
                {mode}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear</button>
        </div>

        {channels.length > 0 ? (
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
        ) : null}
      </div>
    </>
  );
}
