import { unzip } from '/vendor/fflate.js';

const decoder = new TextDecoder('utf-8');
const mediaTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', avif: 'image/avif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' };

function cleanPath(path) {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.some(part => part === '..' || part === '.') || path.startsWith('/')) return null;
  return parts.join('/');
}

function text(node) {
  return node?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function bodyText(node, skipImageItems = false) {
  if (!node) return '';
  const blocks = new Set(['DIV', 'P', 'LI', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE']);
  let result = '';
  function walk(current) {
    if (current.nodeType === 3) {
      const value = current.nodeValue.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ');
      if (value.trim()) result += value;
      else if (!value.includes('\n') && result && !/\s$/.test(result)) result += ' ';
      return;
    }
    if (current.nodeType !== 1) return;
    if (skipImageItems && current.classList.contains('_a7ng')) return;
    if (current.tagName === 'BR') { result += '\n'; return; }
    const isBlock = current !== node && blocks.has(current.tagName);
    if (isBlock && result && !result.endsWith('\n')) result += '\n';
    for (const child of current.childNodes) walk(child);
    if (isBlock && result && !result.endsWith('\n')) result += '\n';
  }
  walk(node);
  return result.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parsePage(bytes) {
  return new DOMParser().parseFromString(decoder.decode(bytes), 'text/html');
}

function resolveArchivePath(pagePath, page, relative) {
  if (!relative || /^(?:https?:|data:|javascript:|#)/i.test(relative)) return null;
  try {
    const virtual = new URL(pagePath, 'https://archive.invalid/');
    const base = new URL(page.querySelector('base')?.getAttribute('href') || '', virtual);
    const resolved = new URL(relative, base);
    return resolved.origin === base.origin ? cleanPath(decodeURIComponent(resolved.pathname.slice(1))) : null;
  } catch { return null; }
}

function externalPostKey(url) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)facebook\.com$/.test(parsed.hostname)) return null;
    const id = parsed.searchParams.get('story_fbid') || parsed.searchParams.get('fbid') || parsed.pathname.match(/(?:posts|videos|permalink)\/(\d+)/)?.[1];
    return id ? `fb:${id}` : null;
  } catch { return null; }
}

function pageEntries(files, predicate) {
  return [...files.keys()].filter(predicate).sort();
}

function mediaFromSection(section, path, page, files, albumDescription = false) {
  const embedded = [...section.querySelectorAll('img[src], video[src], video source[src]')];
  const embeddedPaths = new Set(embedded.map(node => resolveArchivePath(path, page, node.getAttribute('src'))));
  const linked = [...section.querySelectorAll('a[href]')].filter(node => {
    const linkedPath = resolveArchivePath(path, page, node.getAttribute('href'));
    return linkedPath && mediaTypes[linkedPath.split('.').pop()?.toLowerCase()] && !embeddedPaths.has(linkedPath);
  });
  return [...embedded, ...linked].map(node => {
    const mediaPath = resolveArchivePath(path, page, node.getAttribute('src') || node.getAttribute('href'));
    if (!mediaPath || !files.has(mediaPath)) return null;
    const ext = mediaPath.split('.').pop()?.toLowerCase();
    const item = node.closest('._a7ng')?.firstElementChild;
    const details = item ? [...item.children].filter(child => child.tagName !== 'A') : [];
    const tags = details.filter(child => !child.classList.contains('_3-95')).map(child => bodyText(child)).filter(Boolean);
    const description = details.filter(child => child.classList.contains('_3-95')).map(child => bodyText(child)).filter(Boolean).join('\n\n') || (albumDescription ? bodyText(section.querySelector('div._a6-p > div._3-95')) : '');
    return mediaTypes[ext] ? { path: mediaPath, type: mediaTypes[ext], tags, description } : null;
  }).filter(Boolean);
}

function readTimestamp(raw) {
  const zh = raw.match(/(\d{1,2})\s*月\s*(\d{1,2}),?\s*(\d{4})\s*(\d{1,2}):(\d{2}):(\d{2})\s*(上午|下午)/);
  if (zh) {
    let hour = Number(zh[4]) % 12;
    if (zh[7] === '下午') hour += 12;
    return new Date(Number(zh[3]), Number(zh[1]) - 1, Number(zh[2]), hour, Number(zh[5]), Number(zh[6])).getTime();
  }
  const date = Date.parse(raw);
  return Number.isFinite(date) ? date : null;
}

function readPosts(files) {
  const posts = [];
  const paths = pageEntries(files, path => /your_facebook_activity\/posts\/your_posts__.*\.html$/i.test(path));
  for (const path of paths) {
    const page = parsePage(files.get(path));
    for (const section of page.querySelectorAll('main > section')) {
      const title = text(section.querySelector('h2'));
      const body = bodyText(section.querySelector('div._a6-p'), true);
      const dateLabel = text(section.querySelector('footer'));
      const media = mediaFromSection(section, path, page, files);
      const keys = [...section.querySelectorAll('a[href]')].map(a => externalPostKey(a.href)).filter(Boolean);
      if (!title && !body && !media.length) continue;
      posts.push({ id: `post-${posts.length}`, title, body, dateLabel, timestamp: readTimestamp(dateLabel), media, keys, comments: [], reactions: [] });
    }
  }
  return posts.sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity));
}

function readComments(files) {
  const comments = [];
  for (const path of pageEntries(files, path => /your_facebook_activity\/comments_and_reactions\/comments(?:_\d+)?\.html$/i.test(path))) {
    const page = parsePage(files.get(path));
    for (const section of page.querySelectorAll('main > section')) {
      comments.push({ id: `comment-${comments.length}`, title: text(section.querySelector('h2')), body: bodyText(section.querySelector('div._a6-p')), dateLabel: text(section.querySelector('footer')), keys: [...section.querySelectorAll('a[href]')].map(a => externalPostKey(a.href)).filter(Boolean) });
    }
  }
  return comments;
}

function readReactions(files) {
  const reactions = [];
  for (const path of pageEntries(files, path => /your_facebook_activity\/comments_and_reactions\/likes_and_reactions(?:_\d+)?\.html$/i.test(path))) {
    const page = parsePage(files.get(path));
    for (const section of page.querySelectorAll('main > section')) {
      const rows = [...section.querySelectorAll('table tr')].map(row => text(row));
      reactions.push({ id: `reaction-${reactions.length}`, label: rows.slice(0, 3).join(' · '), dateLabel: text(section.querySelector('footer')), keys: [...section.querySelectorAll('a[href]')].map(a => externalPostKey(a.href)).filter(Boolean) });
    }
  }
  return reactions;
}

function readProfile(files) {
  const path = 'personal_information/profile_information/profile_information.html';
  const fields = [];
  if (files.has(path)) {
    const page = parsePage(files.get(path));
    for (const row of page.querySelectorAll('main table tr')) {
      const label = text(row.querySelector('th'));
      const value = bodyText(row.querySelector('td'));
      if (label && value) fields.push({ label, value });
    }
  }
  const name = fields.find(field => /^(?:name|姓名|名稱|名字)$/i.test(field.label))?.value || fields[0]?.value || '';
  return { fields, name, avatarPath: files.has('files/profile_pic.jpg') ? 'files/profile_pic.jpg' : null, coverPath: null };
}

function readAlbums(files) {
  const indexPath = 'your_facebook_activity/posts/your_photos.html';
  const index = files.has(indexPath) ? parsePage(files.get(indexPath)) : null;
  const listed = [];
  if (index) for (const section of index.querySelectorAll('main > section')) {
    const path = [...section.querySelectorAll('a[href]')].map(link => resolveArchivePath(indexPath, index, link.getAttribute('href'))).find(value => /^your_facebook_activity\/posts\/album\/[^/]+\.html$/i.test(value || ''));
    if (path) listed.push({ path, title: text(section.querySelector('h2')) });
  }
  const paths = pageEntries(files, path => /^your_facebook_activity\/posts\/album\/[^/]+\.html$/i.test(path));
  return paths.map((path, index) => {
    const page = parsePage(files.get(path));
    const media = [];
    for (const section of page.querySelectorAll('main > section')) media.push(...mediaFromSection(section, path, page, files, true));
    return { id: `album-${index}`, title: listed.find(item => item.path === path)?.title || text(page.querySelector('h1')) || `Album ${index + 1}`, media };
  }).filter(album => album.media.length);
}

function readCollection(files, folder, prefix) {
  const entries = [];
  for (const path of pageEntries(files, value => value.startsWith(`your_facebook_activity/${folder}/`) && /\.html$/i.test(value))) {
    const page = parsePage(files.get(path));
    for (const section of page.querySelectorAll('main > section')) {
      const title = text(section.querySelector('h2'));
      const body = bodyText(section.querySelector('div._a6-p'), true);
      const dateLabel = text(section.querySelector('footer'));
      const media = mediaFromSection(section, path, page, files);
      if (!title && !body && !media.length) continue;
      entries.push({ id: `${prefix}-${entries.length}`, title, body, dateLabel, timestamp: readTimestamp(dateLabel), media });
    }
  }
  return entries.sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity));
}

function readMessages(files) {
  const indexPath = 'your_facebook_activity/messages/your_messages.html';
  const titles = new Map();
  if (files.has(indexPath)) {
    const page = parsePage(files.get(indexPath));
    for (const link of page.querySelectorAll('main a[href]')) {
      const path = resolveArchivePath(indexPath, page, link.getAttribute('href'));
      if (path) titles.set(path.slice(0, path.lastIndexOf('/')), text(link));
    }
  }
  const pages = pageEntries(files, path => /^your_facebook_activity\/messages\/(?:inbox|e2ee_cutover)\/.+\/message_\d+\.html$/i.test(path));
  const threads = new Map();
  for (const path of pages) {
    const directory = path.slice(0, path.lastIndexOf('/'));
    if (!threads.has(directory)) threads.set(directory, { id: `thread-${threads.size}`, title: titles.get(directory) || '', messages: [] });
    const thread = threads.get(directory);
    const page = parsePage(files.get(path));
    for (const section of page.querySelectorAll('main > section')) {
      const sender = text(section.querySelector('h2'));
      const body = bodyText(section.querySelector('div._a6-p'), true);
      const dateLabel = text(section.querySelector('footer'));
      const media = mediaFromSection(section, path, page, files);
      if (!body && !media.length) continue;
      thread.messages.push({ id: `message-${thread.id}-${thread.messages.length}`, sender, body, dateLabel, timestamp: readTimestamp(dateLabel), media });
    }
    if (!thread.title) thread.title = text(page.querySelector('main > section h2'));
  }
  return [...threads.values()].map(thread => {
    thread.messages.sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity));
    thread.latest = thread.messages.reduce((latest, message) => Math.max(latest, message.timestamp || 0), 0);
    return thread;
  }).filter(thread => thread.messages.length).sort((a, b) => b.latest - a.latest);
}

export function mediaUrl(archive, path) {
  const bytes = archive.files.get(path);
  if (!bytes) return null;
  if (!archive.urls.has(path)) {
    const type = mediaTypes[path.split('.').pop()?.toLowerCase()] || 'application/octet-stream';
    archive.urls.set(path, URL.createObjectURL(new Blob([bytes], { type })));
  }
  return archive.urls.get(path);
}

export function disposeArchive(archive) {
  if (archive) for (const url of archive.urls.values()) URL.revokeObjectURL(url);
}

export async function importArchive(file, onProgress = () => {}, format = 'auto') {
  if (!['auto', 'facebook-html'].includes(format)) throw new Error('unsupportedFormat');
  if (!/\.zip$/i.test(file.name)) throw new Error('chooseFacebookZip');
  if (file.size > 500 * 1024 * 1024) throw new Error('zipTooLarge');
  onProgress('readingZip');
  const input = new Uint8Array(await file.arrayBuffer());
  const unpacked = await new Promise((resolve, reject) => unzip(input, (error, data) => error ? reject(error) : resolve(data)));
  const names = Object.keys(unpacked);
  const root = names.find(name => /(^|\/)start_here\.html$/i.test(name))?.replace(/start_here\.html$/i, '') || '';
  const files = new Map();
  let total = 0;
  for (const [name, bytes] of Object.entries(unpacked)) {
    const path = cleanPath(root && name.startsWith(root) ? name.slice(root.length) : name);
    if (!path || name.endsWith('/')) continue;
    total += bytes.byteLength;
    if (total > 1024 * 1024 * 1024) throw new Error('extractedTooLarge');
    files.set(path, bytes);
  }
  if (!files.has('start_here.html')) throw new Error('htmlNotFound');
  onProgress('readingActivity');
  await new Promise(resolve => setTimeout(resolve, 0));
  const posts = readPosts(files);
  const postByMediaPath = new Map();
  for (const post of posts) for (const item of post.media) {
    if (postByMediaPath.has(item.path) && postByMediaPath.get(item.path) !== post.id) postByMediaPath.set(item.path, null);
    else if (!postByMediaPath.has(item.path)) postByMediaPath.set(item.path, post.id);
  }
  const comments = readComments(files);
  const reactions = readReactions(files);
  const profile = readProfile(files);
  const albums = readAlbums(files);
  profile.coverPath = albums.find(album => /封面|cover/i.test(album.title))?.media[0]?.path || null;
  const stories = readCollection(files, 'stories', 'story');
  const reels = readCollection(files, 'reels', 'reel');
  const liveVideos = readCollection(files, 'live_videos', 'live');
  const videos = [...liveVideos, ...posts.filter(post => post.media.some(item => item.type.startsWith('video/'))).map(post => ({ ...post, id: `video-${post.id}`, media: post.media.filter(item => item.type.startsWith('video/')) }))];
  const threads = readMessages(files);
  const postByKey = new Map(posts.flatMap(post => post.keys.map(key => [key, post])));
  const unmatchedComments = [];
  const unmatchedReactions = [];
  for (const item of comments) {
    const post = item.keys.map(key => postByKey.get(key)).find(Boolean);
    (post ? post.comments : unmatchedComments).push(item);
  }
  for (const item of reactions) {
    const post = item.keys.map(key => postByKey.get(key)).find(Boolean);
    (post ? post.reactions : unmatchedReactions).push(item);
  }
  return { files, urls: new Map(), posts, postByMediaPath, comments, reactions, unmatchedComments, unmatchedReactions, profile, albums, videos, stories, reels, threads, size: total };
}
