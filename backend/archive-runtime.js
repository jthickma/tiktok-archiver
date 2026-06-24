import path from 'path';
import { fileURLToPath } from 'url';
import { createArchiveCatalog } from './archive-catalog.js';
import { database } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const downloadsDir =
  process.env.DOWNLOADS_DIR || path.join(__dirname, '../downloads');

/**
 * Process-wide Archive Catalog used by acquisition and HTTP adapters.
 */
export const archiveCatalog = createArchiveCatalog({
  database,
  downloadsDir,
});
