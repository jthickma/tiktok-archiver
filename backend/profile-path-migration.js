import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const NUMERIC_PROFILE = /^@\d+$/;
const USERNAME_PROFILE = /^@[a-zA-Z0-9_.-]{2,24}$/;

const hashFile = (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const sameFile = (left, right) => {
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  return leftStat.size === rightStat.size && hashFile(left) === hashFile(right);
};

const readableName = (name, numericProfile, usernameProfile) => (
  name.startsWith(`${numericProfile}_`)
    ? `${usernameProfile}${name.slice(numericProfile.length)}`
    : name
);

const mergeEntry = (source, destination, numericProfile, usernameProfile) => {
  const sourceStat = fs.lstatSync(source);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(`Refusing to migrate symbolic link: ${source}`);
  }

  if (!fs.existsSync(destination)) {
    fs.renameSync(source, destination);
    return;
  }

  const destinationStat = fs.lstatSync(destination);
  if (sourceStat.isDirectory() && destinationStat.isDirectory()) {
    mergeDirectory(source, destination, numericProfile, usernameProfile);
    fs.rmdirSync(source);
    return;
  }

  if (sourceStat.isFile() && destinationStat.isFile() && sameFile(source, destination)) {
    fs.unlinkSync(source);
    return;
  }

  throw new Error(`Migration destination already exists with different content: ${destination}`);
};

const mergeDirectory = (sourceDir, destinationDir, numericProfile, usernameProfile) => {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const destinationName = readableName(entry.name, numericProfile, usernameProfile);
    mergeEntry(
      path.join(sourceDir, entry.name),
      path.join(destinationDir, destinationName),
      numericProfile,
      usernameProfile
    );
  }
};

const normalizeDestinationNames = (directory, numericProfile, usernameProfile) => {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const currentPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      normalizeDestinationNames(currentPath, numericProfile, usernameProfile);
    }
    const normalizedName = readableName(entry.name, numericProfile, usernameProfile);
    if (normalizedName !== entry.name) {
      mergeEntry(
        currentPath,
        path.join(directory, normalizedName),
        numericProfile,
        usernameProfile
      );
    }
  }
};

export const rewriteProfilePath = (storedPath, numericProfile, usernameProfile) => {
  if (!storedPath || typeof storedPath !== 'string') return storedPath;
  const segments = storedPath.split('/');
  if (segments[0] !== numericProfile) return storedPath;
  segments[0] = usernameProfile;
  return segments
    .map((segment, index) => index === 0 ? segment : readableName(segment, numericProfile, usernameProfile))
    .join('/');
};

const rewriteMetadata = (metadataJson, numericProfile, usernameProfile) => {
  if (!metadataJson) return metadataJson;
  let metadata;
  try {
    metadata = JSON.parse(metadataJson);
  } catch {
    return metadataJson;
  }
  if (!Array.isArray(metadata.media_files)) return metadataJson;
  metadata.media_files = metadata.media_files.map((filePath) => (
    rewriteProfilePath(filePath, numericProfile, usernameProfile)
  ));
  return JSON.stringify(metadata);
};

const rewriteMetadataPaths = (metadataJson, rewritePath) => {
  if (!metadataJson) return metadataJson;
  let metadata;
  try {
    metadata = JSON.parse(metadataJson);
  } catch {
    return metadataJson;
  }
  if (!Array.isArray(metadata.media_files)) return metadataJson;
  metadata.media_files = metadata.media_files.map(rewritePath);
  return JSON.stringify(metadata);
};

const prefixPostFiles = (directory, postPrefix) => {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const currentPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      prefixPostFiles(currentPath, postPrefix);
      continue;
    }
    if (!entry.isFile() || entry.name.startsWith(`${postPrefix}_`)) continue;
    mergeEntry(currentPath, path.join(directory, `${postPrefix}_${entry.name}`), '', '');
  }
};

const rewriteSlideshowPath = (storedPath, oldDirectory, newDirectory, postPrefix) => {
  if (!storedPath || typeof storedPath !== 'string') return storedPath;
  if (storedPath === oldDirectory) return newDirectory;
  if (!storedPath.startsWith(`${oldDirectory}/`)) return storedPath;
  const remainder = storedPath.slice(oldDirectory.length + 1);
  const segments = remainder.split('/');
  const filename = segments.pop();
  if (filename && !filename.startsWith(`${postPrefix}_`)) {
    segments.push(`${postPrefix}_${filename}`);
  } else if (filename) {
    segments.push(filename);
  }
  return `${newDirectory}/${segments.join('/')}`;
};

export const findProfilePathMappings = (posts) => {
  const mappings = new Map();
  for (const post of posts) {
    const numericProfile = String(post.file_path || '').split('/')[0];
    const usernameProfile = post.channel_id;
    if (!NUMERIC_PROFILE.test(numericProfile) || !USERNAME_PROFILE.test(usernameProfile) || NUMERIC_PROFILE.test(usernameProfile)) {
      continue;
    }
    const existing = mappings.get(numericProfile);
    if (existing && existing !== usernameProfile) {
      throw new Error(`Numeric profile ${numericProfile} maps to both ${existing} and ${usernameProfile}`);
    }
    mappings.set(numericProfile, usernameProfile);
  }
  return mappings;
};

export const migrateNumericProfilePaths = async ({ downloadsDir, posts, updatePost, logger }) => {
  const mappings = findProfilePathMappings(posts);
  let migratedDirectories = 0;
  let updatedPosts = 0;

  for (const [numericProfile, usernameProfile] of mappings) {
    const sourceDir = path.join(downloadsDir, numericProfile);
    const destinationDir = path.join(downloadsDir, usernameProfile);

    try {
      if (fs.existsSync(sourceDir)) {
        mergeDirectory(sourceDir, destinationDir, numericProfile, usernameProfile);
        fs.rmdirSync(sourceDir);
        migratedDirectories++;
      }
      normalizeDestinationNames(destinationDir, numericProfile, usernameProfile);

      for (const post of posts.filter((candidate) => (
        String(candidate.file_path || '').split('/')[0] === numericProfile
      ))) {
        await updatePost({
          id: post.id,
          filePath: rewriteProfilePath(post.file_path, numericProfile, usernameProfile),
          thumbnailPath: rewriteProfilePath(post.thumbnail_path, numericProfile, usernameProfile),
          metadataJson: rewriteMetadata(post.metadata_json, numericProfile, usernameProfile)
        });
        updatedPosts++;
      }
      logger?.info('numeric profile directory migrated', {
        numeric_profile: numericProfile,
        username_profile: usernameProfile
      });
    } catch (error) {
      logger?.error('numeric profile directory migration failed', {
        numeric_profile: numericProfile,
        username_profile: usernameProfile,
        error
      });
    }
  }

  for (const entry of fs.readdirSync(downloadsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !NUMERIC_PROFILE.test(entry.name)) continue;
    const directory = path.join(downloadsDir, entry.name);
    if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  }

  return { mappings: mappings.size, migratedDirectories, updatedPosts };
};

export const migrateSlideshowPostPaths = async ({ downloadsDir, posts, updatePost, logger }) => {
  let migratedPosts = 0;
  for (const post of posts) {
    if (post.type !== 'slideshow' || !USERNAME_PROFILE.test(post.channel_id) || NUMERIC_PROFILE.test(post.channel_id)) {
      continue;
    }
    const oldDirectory = `${post.channel_id}/${post.id}`;
    if (post.file_path !== oldDirectory) continue;

    const postPrefix = `${post.channel_id}_${post.id}`;
    const newDirectory = `${post.channel_id}/${postPrefix}`;
    const oldFullPath = path.join(downloadsDir, oldDirectory);
    const newFullPath = path.join(downloadsDir, newDirectory);
    const rewritePath = (storedPath) => rewriteSlideshowPath(
      storedPath,
      oldDirectory,
      newDirectory,
      postPrefix
    );

    try {
      if (fs.existsSync(oldFullPath)) {
        mergeEntry(oldFullPath, newFullPath, '', '');
      }
      prefixPostFiles(newFullPath, postPrefix);
      await updatePost({
        id: post.id,
        filePath: newDirectory,
        thumbnailPath: rewritePath(post.thumbnail_path),
        metadataJson: rewriteMetadataPaths(post.metadata_json, rewritePath)
      });
      migratedPosts++;
      logger?.info('slideshow path made readable', { post_id: post.id, channel_id: post.channel_id });
    } catch (error) {
      logger?.error('slideshow path migration failed', { post_id: post.id, channel_id: post.channel_id, error });
    }
  }

  let removedEmptyDirectories = 0;
  for (const profile of fs.readdirSync(downloadsDir, { withFileTypes: true })) {
    if (!profile.isDirectory() || !USERNAME_PROFILE.test(profile.name) || NUMERIC_PROFILE.test(profile.name)) continue;
    const profileDir = path.join(downloadsDir, profile.name);
    for (const entry of fs.readdirSync(profileDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const directory = path.join(profileDir, entry.name);
      if (fs.readdirSync(directory).length === 0) {
        fs.rmdirSync(directory);
        removedEmptyDirectories++;
      }
    }
  }
  return { migratedPosts, removedEmptyDirectories };
};
