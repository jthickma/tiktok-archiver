import {
  downloadPost,
  downloadWithGalleryDl,
  getMetadata,
  scanProfile,
} from './downloader.js';

/**
 * Acquisition module.
 *
 * The queue depends on this small interface. Child-process execution,
 * provider parsing, fallback behavior, and archive persistence remain inside
 * downloader.js, where they retain locality.
 */
export const createAcquisition = (adapters = {}) =>
  Object.freeze({
    scanProfile: adapters.scanProfile || scanProfile,
    downloadPost: adapters.downloadPost || downloadPost,
    downloadGallery: adapters.downloadGallery || downloadWithGalleryDl,
    getMetadata: adapters.getMetadata || getMetadata,
  });

export const acquisition = createAcquisition();
