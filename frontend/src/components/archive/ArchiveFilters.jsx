import React from 'react';

const MEDIA_TYPES = ['', 'video', 'slideshow', 'image', 'gallery', 'audio'];
const DENSITIES = ['dense', 'compact', 'wide'];

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

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
  const filterCount = [
    selectedType,
    selectedChannels.length > 0,
    dateFrom,
    dateTo,
    missingThumbnail,
  ].filter(Boolean).length;

  return (
    <section className="archive-controls" aria-label="Archive controls">
      <div className="archive-toolbar">
        <label className="archive-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            className="text-input search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search captions, titles, and profiles"
            aria-label="Search archive"
          />
        </label>
        <button
          type="button"
          className={`btn btn-secondary archive-filter-toggle ${filtersOpen ? 'active' : ''}`}
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="archive-advanced-filters"
        >
          <FilterIcon />
          <span>Filters</span>
          {filterCount > 0 ? <span className="filter-count">{filterCount}</span> : null}
        </button>
      </div>

      <div className="archive-quickbar">
        <div className="segmented-control media-type-filter" aria-label="Media type">
          {MEDIA_TYPES.map((type) => (
            <button key={type || 'all'} type="button" className={selectedType === type ? 'active' : ''} onClick={() => setSelectedType(type)}>
              {type || 'all'}
            </button>
          ))}
        </div>
        <div className="segmented-control density-control" aria-label="Grid density">
          {DENSITIES.map((mode) => (
            <button key={mode} type="button" className={density === mode ? 'active' : ''} onClick={() => setDensity(mode)}>
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div id="archive-advanced-filters" className={`archive-filters ${filtersOpen ? 'open' : ''}`} hidden={!filtersOpen}>
        <div className="filter-dock">
          <label className="filter-field">
            <span>Sort by</span>
            <select className="select-input" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="upload_date">Upload date</option>
              <option value="downloaded_at">Download date</option>
              <option value="profile">Profile</option>
              <option value="type">Type</option>
              <option value="title">Title</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Order</span>
            <select className="select-input" value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Page size</span>
            <select className="select-input" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              {[24, 36, 60, 100].map((value) => <option key={value} value={value}>{value} items</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span>From</span>
            <input className="date-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="filter-field">
            <span>To</span>
            <input className="date-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label className="check-pill thumbnail-filter">
            <input type="checkbox" checked={missingThumbnail} onChange={(event) => setMissingThumbnail(event.target.checked)} />
            Missing thumbnail
          </label>
          <button type="button" className="btn btn-secondary clear-filter-btn" onClick={clearFilters} disabled={filterCount === 0 && !search}>Reset filters</button>
        </div>

        {channels.length > 0 ? (
          <div className="profile-filter-group">
            <span>Profiles</span>
            <div className="profile-filter" aria-label="Profile filters">
              {channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className={selectedChannels.includes(channel.id) ? 'active' : ''}
                  onClick={() => toggleChannel(channel.id)}
                  aria-pressed={selectedChannels.includes(channel.id)}
                >
                  @{channel.username}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
