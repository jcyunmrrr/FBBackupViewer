import { importArchive, mediaUrl, disposeArchive } from './parser.js';
import { locale, setLocale, t, number } from './i18n.js';

const app = document.querySelector('#app');
function syncPageLanguage() {
  document.documentElement.lang = locale;
  document.title = t('title');
  document.querySelector('meta[name="description"]').content = t('description');
  document.querySelector('link[rel="manifest"]').href = locale === 'en' ? 'manifest.en.webmanifest' : 'manifest.webmanifest';
}
syncPageLanguage();
let archive = null;
let view = 'feed';
let query = '';
let visibleCount = 24;
let status = '';
let error = '';
let selectedFormat = 'auto';
let viewer = null;
let postViewerId = null;
let returnViewer = null;
let postViewerFocus = null;
let selectedAlbumId = null;
let selectedThreadId = null;
let visibleMessages = 80;
const navigation = [['feed', 'feed'], ['profile', 'profile'], ['photos', 'media'], ['albums', 'albums'], ['videos', 'videos'], ['stories', 'stories'], ['reels', 'reels'], ['messages', 'messages'], ['activity', 'activity']];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motion = { fast: 150, normal: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };

function animate(element, frames, duration = motion.normal) {
  if (reducedMotion.matches || !element?.animate) return null;
  return element.animate(frames, { duration, easing: motion.easing });
}

function animateContentIn() {
  animate(app.querySelector('.main-content'), [
    { opacity: 0.7, transform: 'translateY(8px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ]);
}

function switchView(nextView) {
  if (view === nextView) return;
  view = nextView;
  visibleCount = 24;
  query = '';
  render();
  window.scrollTo(0, 0);
  animateContentIn();
}

function toggleDetail(detail) {
  if (!detail) return;
  const opening = detail.hidden || detail.dataset.closing === 'true';
  detail.getAnimations?.().forEach(animation => animation.cancel());
  delete detail.dataset.closing;
  if (opening) {
    detail.hidden = false;
    const openingAnimation = animate(detail, [
      { height: '0px', opacity: 0, transform: 'translateY(-6px)' },
      { height: `${detail.scrollHeight}px`, opacity: 1, transform: 'translateY(0)' }
    ]);
    if (openingAnimation) {
      detail.style.overflow = 'hidden';
      openingAnimation.finished.then(() => { if (detail.dataset.closing !== 'true') detail.style.overflow = ''; }).catch(() => {});
    } else detail.style.overflow = '';
  } else {
    detail.dataset.closing = 'true';
    const closing = animate(detail, [
      { height: `${detail.getBoundingClientRect().height}px`, opacity: 1, transform: 'translateY(0)' },
      { height: '0px', opacity: 0, transform: 'translateY(-6px)' }
    ]);
    if (closing) {
      detail.style.overflow = 'hidden';
      closing.finished.then(() => { if (detail.dataset.closing === 'true') { detail.hidden = true; detail.style.overflow = ''; } }).catch(() => {});
    } else { detail.hidden = true; detail.style.overflow = ''; }
  }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function readableSize(bytes) {
  return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

function getGallery(id) {
  if (!archive) return null;
  return [archive.posts, archive.albums, archive.videos, archive.stories, archive.reels, ...archive.threads.map(thread => thread.messages)]
    .flat().find(item => item.id === id) || null;
}

function associatedPost(source, media) {
  if (!archive || !media) return null;
  if (source?.id?.startsWith('post-')) return archive.posts.find(post => post.id === source.id) || null;
  const id = archive.postByMediaPath.get(media.path);
  return id ? archive.posts.find(post => post.id === id) || null : null;
}

function icon(name, size = 20) {
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    photo: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    activity: '<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="18" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    comment: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z"/>',
    like: '<path d="M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3Zm0 0 4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2l-1 7a2 2 0 0 1-2 2H7"/>',
    close: '<path d="M5 5 19 19M19 5 5 19"/>',
    previous: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function renderPost(post) {
  const media = post.media.slice(0, 4).map((item, index) => {
    const src = mediaUrl(archive, item.path);
    const preview = item.type.startsWith('video/') ? `<video src="${esc(src)}" muted preload="metadata"></video>` : `<img src="${esc(src)}" alt="${t('archivedMedia')}" loading="lazy">`;
    return `<button class="media-tile" data-post="${esc(post.id)}" data-index="${index}" aria-label="${t('openMedia')} ${index + 1}">${preview}</button>`;
  }).join('');
  const hasMore = post.media.length > 4;
  return `<article class="post-card" data-post-card="${esc(post.id)}">
    <div class="post-head"><div class="avatar">${icon('home', 22)}</div><div class="post-identity"><button class="post-title-button" data-open-post="${esc(post.id)}">${esc(post.title || t('archivedPost'))}</button><span>${esc(post.dateLabel || t('dateUnavailable'))} <span class="dot">·</span> ${t('archived')}</span></div><span class="post-menu" aria-hidden="true">···</span></div>
    ${post.body ? `<p class="post-body">${esc(post.body)}</p>` : ''}
    ${media ? `<div class="media-grid count-${Math.min(post.media.length, 4)}">${media}${hasMore ? `<span class="media-more">+${post.media.length - 4}</span>` : ''}</div>` : ''}
    <div class="engagement"><span>${icon('like', 15)} ${post.reactions.length ? `${number(post.reactions.length)} ${t('linkedReactions')}` : t('reactionsLabel')}</span><span>${post.comments.length ? `${number(post.comments.length)} ${t('linkedComments')}` : t('commentsLabel')}</span></div>
    <div class="post-actions"><button class="action" data-toggle="${esc(post.id)}">${icon('like', 18)} ${t('reactionsLabel')}</button><button class="action" data-toggle="${esc(post.id)}">${icon('comment', 18)} ${t('commentsLabel')}</button></div>
    <div class="post-detail" id="detail-${esc(post.id)}" hidden>${post.comments.length || post.reactions.length ? `${post.reactions.map(item => `<p class="linked-item">${icon('like', 16)} <span>${esc(item.label || t('reaction'))} <small>${esc(item.dateLabel)}</small></span></p>`).join('')}${post.comments.map(item => `<p class="linked-item">${icon('comment', 16)} <span>${esc(item.body || item.title)} <small>${esc(item.dateLabel)}</small></span></p>`).join('')}` : `<p class="muted">${t('noPostLink')}</p>`}</div>
  </article>`;
}

function renderActivity() {
  const items = [
    ...archive.comments.map(item => ({ ...item, kind: 'comment', linked: !archive.unmatchedComments.includes(item) })),
    ...archive.reactions.map(item => ({ ...item, kind: 'reaction', linked: !archive.unmatchedReactions.includes(item) }))
  ].filter(item => `${item.title || ''} ${item.body || ''} ${item.label || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, visibleCount);
  return `<div class="section-heading"><div><h1>${t('activityTitle')}</h1><p>${t('activityIntro')}</p></div></div>
    <div class="activity-list">${items.map(item => `<article class="activity-card"><span class="activity-symbol">${icon(item.kind === 'comment' ? 'comment' : 'like', 19)}</span><div><strong>${esc(item.kind === 'comment' ? item.title || t('comment') : t('reaction'))}</strong><p>${esc(item.kind === 'comment' ? item.body : item.label)}</p><small>${esc(item.dateLabel)} · ${item.linked ? t('linkedToPost') : t('postLinkUnavailable')}</small></div></article>`).join('') || `<div class="empty-small">${t('noActivity')}</div>`}</div>
    ${items.length === visibleCount ? `<button class="load-more" id="more">${t('moreActivity')}</button>` : ''}`;
}

function renderGalleryTiles(item, limit = visibleCount) {
  return item.media.slice(0, limit).map((media, index) => {
    const src = mediaUrl(archive, media.path);
    const preview = media.type.startsWith('video/') ? `<video src="${esc(src)}" muted preload="metadata"></video>` : `<img src="${esc(src)}" alt="${t('archivedMedia')}" loading="lazy">`;
    return `<button class="gallery-tile" data-post="${esc(item.id)}" data-index="${index}" aria-label="${t('openMedia')} ${index + 1}">${preview}</button>`;
  }).join('');
}

function renderProfile() {
  const profile = archive.profile;
  return `<div class="section-heading"><div><h1>${t('profileDetails')}</h1></div></div>
    ${profile.fields.length ? `<div class="profile-fields">${profile.fields.map(field => `<div class="profile-field"><span>${esc(field.label)}</span><strong>${esc(field.value)}</strong></div>`).join('')}</div>` : `<div class="empty-small">${t('noProfile')}</div>`}`;
}

function renderAlbums() {
  const selected = archive.albums.find(album => album.id === selectedAlbumId);
  if (selected) return `<div class="section-heading"><div><button class="back-link" id="back-albums">← ${t('backToAlbums')}</button><h1>${esc(selected.title)}</h1><p>${t('photoCount', { count: number(selected.media.length) })}</p></div></div><div class="album-photo-grid">${renderGalleryTiles(selected)}</div>${selected.media.length > visibleCount ? `<button class="load-more" id="more">${t('morePosts')}</button>` : ''}`;
  return `<div class="section-heading"><div><h1>${t('albums')}</h1><p>${t('itemCount', { count: number(archive.albums.length) })}</p></div></div>${archive.albums.length ? `<div class="album-list">${archive.albums.map(album => `<button class="album-card" data-album="${esc(album.id)}"><img src="${esc(mediaUrl(archive, album.media[0].path))}" alt="" loading="lazy"><span><strong>${esc(album.title || t('untitledAlbum'))}</strong><small>${t('photoCount', { count: number(album.media.length) })}</small></span></button>`).join('')}</div>` : `<div class="empty-small">${t('noAlbums')}</div>`}`;
}

function renderCollection(items, titleKey, emptyKey) {
  const filtered = items.filter(item => `${item.title} ${item.body} ${item.dateLabel}`.toLowerCase().includes(query.toLowerCase()));
  const cards = filtered.slice(0, visibleCount).map(item => {
    const original = item.media.map(media => associatedPost(item, media)).find(Boolean);
    return `<article class="post-card collection-card" ${original ? `data-post-card="${esc(original.id)}"` : ''}><div class="post-head"><div class="avatar">${icon('photo', 20)}</div><div class="post-identity">${original ? `<button class="post-title-button" data-open-post="${esc(original.id)}">${esc(item.title || t(titleKey))}</button>` : `<strong>${esc(item.title || t(titleKey))}</strong>`}<span>${esc(item.dateLabel || t('dateUnavailable'))}</span></div></div>${item.body ? `<p class="post-body">${esc(item.body)}</p>` : ''}${item.media.length ? `<div class="album-photo-grid collection-media">${renderGalleryTiles(item, 4)}</div>` : ''}</article>`;
  }).join('');
  return `<div class="section-heading"><div><h1>${t(titleKey)}</h1><p>${t('itemCount', { count: number(filtered.length) })}</p></div></div>${filtered.length ? cards : `<div class="empty-small">${t(emptyKey)}</div>`}${filtered.length > visibleCount ? `<button class="load-more" id="more">${t('morePosts')}</button>` : ''}`;
}

function renderMessages() {
  const threads = archive.threads.filter(thread => thread.title.toLowerCase().includes(query.toLowerCase()));
  const selected = archive.threads.find(thread => thread.id === selectedThreadId);
  const messages = selected?.messages.slice(-visibleMessages) || [];
  return `<div class="section-heading"><div><h1>${t('messages')}</h1><p>${t('itemCount', { count: number(archive.threads.length) })}</p></div></div>${archive.threads.length ? `<div class="messages-layout ${selected ? 'thread-selected' : ''}"><div class="thread-list">${threads.map(thread => `<button class="thread-button ${thread.id === selectedThreadId ? 'active' : ''}" data-thread="${esc(thread.id)}"><strong>${esc(thread.title || t('unnamedThread'))}</strong><small>${t('messageCount', { count: number(thread.messages.length) })}</small></button>`).join('')}</div><div class="conversation">${selected ? `<div class="conversation-head"><button class="back-link" id="back-threads">← ${t('backToThreads')}</button><h2>${esc(selected.title || t('unnamedThread'))}</h2></div>${selected.messages.length > visibleMessages ? `<button class="load-more" id="older-messages">${t('olderMessages')}</button>` : ''}<div class="message-list">${messages.map(message => `<article class="message ${message.sender && message.sender === archive.profile.name ? 'own' : ''}"><strong>${esc(message.sender)}</strong>${message.body ? `<p>${esc(message.body)}</p>` : ''}${message.media.length ? `<div class="message-media">${renderGalleryTiles(message, 4)}</div>` : ''}<small>${esc(message.dateLabel)}</small></article>`).join('')}</div>` : `<div class="conversation-placeholder">${t('chooseThread')}</div>`}</div></div>` : `<div class="empty-small">${t('noMessages')}</div>`}`;
}

function renderContent() {
  if (status && !archive) return `<section class="import-loading" role="status" aria-live="polite"><div class="loading-spinner" aria-hidden="true"></div><h1>${esc(t(status))}</h1><div class="skeleton-card" aria-hidden="true"><div class="skeleton-line wide"></div><div class="skeleton-line medium"></div><div class="skeleton-block"></div><div class="skeleton-line short"></div></div></section>`;
  if (!archive) return `<section class="welcome-card minimal-welcome"><h1>${t('welcomeTitle')}</h1><p>${t('welcomeBody')}</p><label class="format-label" for="format">${t('exportFormat')}</label><select id="format" class="format-select"><option value="auto" ${selectedFormat === 'auto' ? 'selected' : ''}>${t('autoDetect')}</option><option value="facebook-html" ${selectedFormat === 'facebook-html' ? 'selected' : ''}>${t('facebookHtml')}</option></select><div class="drop-zone" id="drop-zone"><div class="drop-icon">${icon('upload', 27)}</div><strong>${t('dropZip')}</strong><span>${t('or')}</span><label class="primary-button upload-button">${t('chooseZip')}<input id="file-input" class="file-input" type="file" accept=".zip,application/zip" aria-label="${t('chooseZip')}"></label></div><div class="welcome-note">${icon('lock', 16)} ${t('staysLocal')}</div></section>`;
  if (view === 'profile') return renderProfile();
  if (view === 'albums') return renderAlbums();
  if (view === 'videos') return renderCollection(archive.videos, 'videos', 'noVideos');
  if (view === 'stories') return renderCollection(archive.stories, 'stories', 'noStories');
  if (view === 'reels') return renderCollection(archive.reels, 'reels', 'noReels');
  if (view === 'messages') return renderMessages();
  if (view === 'activity') return renderActivity();
  const posts = archive.posts.filter(post => {
    if (view === 'photos' && !post.media.length) return false;
    return `${post.title} ${post.body} ${post.dateLabel}`.toLowerCase().includes(query.toLowerCase());
  });
  return `<div class="section-heading"><div><div class="eyebrow">${t(view === 'photos' ? 'yourMedia' : 'yourTimeline')}</div><h1>${t(view === 'photos' ? 'media' : 'feedTitle')}</h1><p>${number(posts.length)} ${t(view === 'photos' ? 'foundMedia' : 'foundPosts')} ${t('foundSuffix')}</p></div><div class="sort-pill">${t('newest')}</div></div>
    ${posts.slice(0, visibleCount).map(renderPost).join('') || `<div class="empty-small">${t('noPosts')}</div>`}
    ${posts.length > visibleCount ? `<button class="load-more" id="more">${t('morePosts')}</button>` : ''}`;
}

function openPostViewer(id) {
  if (!archive?.posts.some(post => post.id === id)) return;
  postViewerFocus = document.activeElement;
  returnViewer = viewer ? { ...viewer } : null;
  if (viewer) closeViewer(true);
  postViewerId = id;
  document.body.classList.add('post-viewer-open');
  renderPostViewer();
  app.querySelector('#post-viewer-close')?.focus();
}

function closePostViewer() {
  postViewerId = null;
  document.body.classList.remove('post-viewer-open');
  const box = app.querySelector('#post-viewer');
  if (box) {
    box.getAnimations?.().forEach(animation => animation.cancel());
    const closing = returnViewer ? null : animate(box, [{ opacity: 1 }, { opacity: 0 }], motion.fast);
    if (closing) closing.finished.then(() => { if (!postViewerId) box.hidden = true; }).catch(() => {});
    else box.hidden = true;
  }
  if (returnViewer) {
    viewer = returnViewer;
    returnViewer = null;
    renderViewer();
    app.querySelector('#source-post')?.focus();
  } else if (postViewerFocus?.isConnected) {
    postViewerFocus.focus();
  }
  postViewerFocus = null;
}

function renderPostViewer() {
  const box = app.querySelector('#post-viewer');
  const post = archive?.posts.find(item => item.id === postViewerId);
  if (!box || !post) return;
  const opening = box.hidden;
  const media = post.media.map((item, index) => {
    const src = mediaUrl(archive, item.path);
    const preview = item.type.startsWith('video/') ? `<video src="${esc(src)}" muted preload="metadata"></video>` : `<img src="${esc(src)}" alt="${t('archivedMedia')}" loading="lazy">`;
    return `<button class="post-viewer-media-tile" data-post-media="${index}" aria-label="${t('openMedia')} ${index + 1}">${preview}</button>`;
  }).join('');
  box.innerHTML = `<div class="post-viewer-dialog" role="dialog" aria-modal="true" aria-label="${t('postViewerTitle')}"><header class="post-viewer-header"><h2>${t('postViewerTitle')}</h2><button class="post-viewer-close" id="post-viewer-close" aria-label="${t('closePost')}">${icon('close', 20)}</button></header><div class="post-viewer-scroll"><div class="post-head"><div class="avatar">${icon('home', 22)}</div><div class="post-identity"><strong>${esc(post.title || t('archivedPost'))}</strong><span>${esc(post.dateLabel || t('dateUnavailable'))} · ${t('archived')}</span></div></div>${post.body ? `<p class="post-body">${esc(post.body)}</p>` : ''}${media ? `<div class="post-viewer-media-grid ${post.media.length === 1 ? 'single' : ''}">${media}</div>` : ''}<div class="post-viewer-engagement"><span>${icon('like', 16)} ${number(post.reactions.length)} ${t('reactionsLabel')}</span><span>${icon('comment', 16)} ${number(post.comments.length)} ${t('commentsLabel')}</span></div><section class="post-viewer-section"><h3>${t('reactionsLabel')}</h3>${post.reactions.length ? post.reactions.map(item => `<div class="post-viewer-detail">${icon('like', 16)}<div><p>${esc(item.label || t('reaction'))}</p><small>${esc(item.dateLabel)}</small></div></div>`).join('') : `<p class="post-viewer-empty">${t('noLinkedReactions')}</p>`}</section><section class="post-viewer-section"><h3>${t('commentsLabel')}</h3>${post.comments.length ? post.comments.map(item => `<div class="post-viewer-detail">${icon('comment', 16)}<div><p>${esc(item.body || item.title)}</p><small>${esc(item.dateLabel)}</small></div></div>`).join('') : `<p class="post-viewer-empty">${t('noLinkedComments')}</p>`}</section></div></div>`;
  box.hidden = false;
  if (opening) {
    animate(box, [{ opacity: 0 }, { opacity: 1 }], motion.fast);
    animate(box.querySelector('.post-viewer-dialog'), [{ opacity: 0.8, transform: 'translateY(10px) scale(.99)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }]);
  }
  box.querySelector('#post-viewer-close').addEventListener('click', closePostViewer);
  box.querySelectorAll('[data-post-media]').forEach(button => button.addEventListener('click', () => {
    viewer = { postId: post.id, index: Number(button.dataset.postMedia) };
    renderViewer();
    app.querySelector('#viewer-close')?.focus();
  }));
  box.onclick = event => { if (event.target === box) closePostViewer(); };
}

function closeViewer(instant = false) {
  viewer = null;
  document.body.classList.remove('viewer-open');
  const box = app.querySelector('#lightbox');
  if (!box) return;
  box.getAnimations?.().forEach(animation => animation.cancel());
  const closing = instant ? null : animate(box, [{ opacity: 1 }, { opacity: 0 }], motion.fast);
  if (closing) closing.finished.then(() => { if (!viewer) box.hidden = true; }).catch(() => {});
  else box.hidden = true;
  if (postViewerId && !instant) app.querySelector('#post-viewer-close')?.focus();
}

function moveViewer(direction) {
  if (!viewer || !archive) return;
  const post = getGallery(viewer.postId);
  if (!post) return;
  const nextIndex = viewer.index + direction;
  if (nextIndex < 0 || nextIndex >= post.media.length) return;
  viewer.index = nextIndex;
  renderViewer(direction);
  app.querySelector(direction < 0 ? '#viewer-previous' : '#viewer-next')?.focus();
}

function renderViewer(direction = 0) {
  const box = app.querySelector('#lightbox');
  if (!box || !viewer || !archive) return;
  const opening = box.hidden;
  const previousMedia = direction && !reducedMotion.matches ? (box.querySelector('.viewer-ghost') || box.querySelector('.viewer-media'))?.cloneNode(true) : null;
  box.getAnimations?.().forEach(animation => animation.cancel());
  const post = getGallery(viewer.postId);
  const item = post?.media[viewer.index];
  if (!item) { closeViewer(); return; }
  const src = mediaUrl(archive, item.path);
  const tags = item.tags.map(tag => `<span class="image-tag">${esc(tag)}</span>`).join('');
  const details = `${tags ? `<section><h3>${t('imageTags')}</h3><div class="image-tags">${tags}</div></section>` : ''}${item.description ? `<section><h3>${t('imageDescription')}</h3><p class="image-description">${esc(item.description)}</p></section>` : ''}`;
  const originalPost = associatedPost(post, item);
  const media = item.type.startsWith('video/') ? `<video class="viewer-media" src="${esc(src)}" controls></video>` : `<img class="viewer-media" src="${esc(src)}" alt="${t('archivedMedia')}">`;
  box.innerHTML = `<div class="viewer-shell"><div class="viewer-stage"><button class="viewer-close" id="viewer-close" aria-label="${t('closeMedia')}">${icon('close', 22)}</button><button class="viewer-nav previous" id="viewer-previous" aria-label="${t('previousImage')}" ${viewer.index === 0 ? 'disabled' : ''}>${icon('previous', 26)}</button>${media}<button class="viewer-nav next" id="viewer-next" aria-label="${t('nextImage')}" ${viewer.index === post.media.length - 1 ? 'disabled' : ''}>${icon('next', 26)}</button></div><aside class="viewer-info"><div class="eyebrow">${t('imageInfo')}</div><h2>${t('imagePosition', { current: number(viewer.index + 1), total: number(post.media.length) })}</h2><section class="source-post-section">${originalPost ? `<button class="source-post-button" id="source-post">${t('viewOriginalPost')} →</button>` : `<p class="viewer-empty">${t('noAssociatedPost')}</p>`}</section>${details || `<p class="viewer-empty">${t('noImageMetadata')}</p>`}</aside></div>`;
  box.hidden = false;
  document.body.classList.add('viewer-open');
  if (opening) {
    animate(box, [{ opacity: 0 }, { opacity: 1 }], motion.fast);
    animate(box.querySelector('.viewer-shell'), [{ opacity: 0.8, transform: 'scale(0.985)' }, { opacity: 1, transform: 'scale(1)' }]);
  } else if (previousMedia) {
    const stage = box.querySelector('.viewer-stage');
    const nextMedia = stage.querySelector('.viewer-media');
    previousMedia.classList.remove('viewer-media');
    previousMedia.classList.add('viewer-ghost');
    previousMedia.removeAttribute('controls');
    stage.appendChild(previousMedia);
    const play = () => {
      if (!nextMedia.isConnected) return;
      animate(nextMedia, [{ opacity: 0.4, transform: `translateX(${direction * 12}px)` }, { opacity: 1, transform: 'translateX(0)' }]);
      const outgoing = animate(previousMedia, [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-direction * 12}px)` }]);
      if (outgoing) outgoing.finished.then(() => previousMedia.remove()).catch(() => previousMedia.remove());
      else previousMedia.remove();
      animate(box.querySelector('.viewer-info'), [{ opacity: 0.7, transform: `translateX(${direction * 6}px)` }, { opacity: 1, transform: 'translateX(0)' }]);
    };
    if (nextMedia.tagName === 'IMG' && !nextMedia.complete) {
      nextMedia.addEventListener('load', play, { once: true });
      nextMedia.addEventListener('error', play, { once: true });
    } else play();
  }
  box.querySelector('#viewer-close').addEventListener('click', () => closeViewer());
  box.querySelector('#viewer-previous').addEventListener('click', () => moveViewer(-1));
  box.querySelector('#viewer-next').addEventListener('click', () => moveViewer(1));
  box.querySelector('#source-post')?.addEventListener('click', () => openPostViewer(originalPost.id));
  box.onclick = event => { if (event.target === box) closeViewer(); };
}

function render() {
  const profileName = archive?.profile.name || t('profileTitle');
  const avatar = archive?.profile.avatarPath ? `<img class="profile-picture" src="${esc(mediaUrl(archive, archive.profile.avatarPath))}" alt="">` : icon('home', 31);
  const cover = archive?.profile.coverPath ? `<img class="cover-photo" src="${esc(mediaUrl(archive, archive.profile.coverPath))}" alt="">` : '<span class="cover-circle a"></span><span class="cover-circle b"></span><span class="cover-circle c"></span>';
  const navItems = navigation.map(([id, label]) => `<button data-view="${id}" class="nav-item ${view === id ? 'active' : ''}">${icon(id === 'profile' ? 'home' : id === 'messages' || id === 'activity' ? 'activity' : id === 'feed' ? 'home' : 'photo')} <span>${t(label)}</span></button>`).join('');
  const mobileOptions = navigation.map(([id, label]) => `<option value="${id}" ${view === id ? 'selected' : ''}>${t(label)}</option>`).join('');
  app.innerHTML = `<header class="topbar"><div class="topbar-inner"><div class="brand"><div class="brand-mark">f</div><div><strong>${t('title')}</strong><small>${t('brandSub')}</small></div></div><div class="top-actions"><label class="language-control"><span>${t('language')}</span><select id="language" aria-label="${t('language')}"><option value="zh-TW" ${locale === 'zh-TW' ? 'selected' : ''}>繁體中文</option><option value="en" ${locale === 'en' ? 'selected' : ''}>English</option></select></label>${archive ? `<span class="private-badge">${icon('lock', 15)} ${t('privateOffline')}</span><button class="top-button" id="change-file">${t('openAnother')}</button>` : ''}</div></div></header>
    <div class="layout ${archive ? '' : 'empty-layout'}">${archive ? `<aside class="left-sidebar"><div class="side-label">${t('library')}</div><nav aria-label="${t('library')}">${navItems}</nav><div class="side-divider"></div><div class="side-note">${t('sideNote')}</div></aside>` : ''}
    <main class="main-content">${archive ? `<div class="profile-cover"><div class="cover-art">${cover}</div><div class="profile-bottom"><div class="profile-avatar">${avatar}</div><div><h2>${esc(profileName)}</h2><p>${number(archive.posts.length)} ${t('posts')} · ${number(archive.comments.length)} ${t('comments')} · ${number(archive.reactions.length)} ${t('reactions')}</p></div></div></div><select class="mobile-view-select" id="mobile-view" aria-label="${t('library')}">${mobileOptions}</select>${view === 'profile' || view === 'albums' ? '' : `<div class="search-box">${icon('search', 18)} <input id="search" type="search" placeholder="${t('search')}" value="${esc(query)}" aria-label="${t('search')}"></div>`}` : ''}
    ${status && archive ? `<div class="notice loading" role="status">${esc(t(status))}</div>` : ''}${error ? `<div class="notice error" role="alert">${esc(t(error))}</div>` : ''}${renderContent()}</main>
    ${archive ? `<aside class="right-sidebar"><div class="info-card"><div class="info-icon">${icon('lock', 19)}</div><h3>${t('madeForMemories')}</h3><p>${t('privacyBody')}</p></div><div class="info-card archive-stats"><h3>${t('aboutArchive')}</h3><div><span>${t('format')}</span><strong>Facebook HTML</strong></div><div><span>${t('extractedSize')}</span><strong>${readableSize(archive.size)}</strong></div><div><span>${t('postsLabel')}</span><strong>${number(archive.posts.length)}</strong></div><div><span>${t('unlinkedComments')}</span><strong>${number(archive.unmatchedComments.length)}</strong></div><div><span>${t('unlinkedReactions')}</span><strong>${number(archive.unmatchedReactions.length)}</strong></div><button id="close-archive" class="clear-button">${t('closeArchive')}</button></div></aside>` : ''}</div>
    <input id="hidden-file" type="file" accept=".zip,application/zip" hidden><div id="post-viewer" class="post-viewer" hidden></div><div id="lightbox" class="lightbox" hidden></div>`;
  bind();
  if (postViewerId) renderPostViewer();
  if (viewer) renderViewer();
}

function bind() {
  app.querySelector('#language')?.addEventListener('change', event => { setLocale(event.target.value); syncPageLanguage(); render(); animateContentIn(); });
  app.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  app.querySelectorAll('[data-open-post]').forEach(button => button.addEventListener('click', () => openPostViewer(button.dataset.openPost)));
  app.querySelectorAll('[data-post-card]').forEach(card => card.addEventListener('click', event => { if (!event.target.closest('button, a, input, select')) openPostViewer(card.dataset.postCard); }));
  app.querySelector('#mobile-view')?.addEventListener('change', event => switchView(event.target.value));
  app.querySelectorAll('[data-album]').forEach(button => button.addEventListener('click', () => { selectedAlbumId = button.dataset.album; visibleCount = 24; render(); animateContentIn(); }));
  app.querySelector('#back-albums')?.addEventListener('click', () => { selectedAlbumId = null; render(); animateContentIn(); });
  app.querySelectorAll('[data-thread]').forEach(button => button.addEventListener('click', () => { selectedThreadId = button.dataset.thread; visibleMessages = 80; render(); const list = app.querySelector('.message-list'); if (list) list.scrollTop = list.scrollHeight; animateContentIn(); }));
  app.querySelector('#back-threads')?.addEventListener('click', () => { selectedThreadId = null; render(); animateContentIn(); });
  app.querySelector('#older-messages')?.addEventListener('click', () => { const previous = app.querySelector('.message-list'); const height = previous?.scrollHeight || 0; const top = previous?.scrollTop || 0; visibleMessages += 80; render(); const list = app.querySelector('.message-list'); if (list) list.scrollTop = list.scrollHeight - height + top; });
  app.querySelectorAll('input[type=file]').forEach(input => input.addEventListener('change', event => { const file = event.target.files?.[0]; if (file) loadFile(file); }));
  const dropZone = app.querySelector('#drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragenter', event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('drag-over'); const file = event.dataTransfer?.files?.[0]; if (file) loadFile(file); });
  }
  app.querySelector('#format')?.addEventListener('change', event => { selectedFormat = event.target.value; });
  app.querySelector('#change-file')?.addEventListener('click', () => app.querySelector('#hidden-file').click());
  app.querySelector('#close-archive')?.addEventListener('click', () => { closeViewer(true); postViewerId = null; returnViewer = null; postViewerFocus = null; document.body.classList.remove('post-viewer-open'); disposeArchive(archive); archive = null; query = ''; error = ''; render(); animateContentIn(); });
  app.querySelector('#search')?.addEventListener('input', event => { query = event.target.value; visibleCount = 24; const cursor = event.target.selectionStart; render(); const input = app.querySelector('#search'); input.focus(); input.setSelectionRange(cursor, cursor); });
  app.querySelector('#more')?.addEventListener('click', () => { visibleCount += 24; render(); animate(app.querySelector('.main-content'), [{ opacity: 0.85 }, { opacity: 1 }], motion.fast); });
  app.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click', () => toggleDetail(document.getElementById(`detail-${button.dataset.toggle}`))));
  app.querySelectorAll('[data-post][data-index]').forEach(button => button.addEventListener('click', () => { viewer = { postId: button.dataset.post, index: Number(button.dataset.index) }; renderViewer(); app.querySelector('#viewer-close')?.focus(); }));
}

async function loadFile(file) {
  error = ''; status = 'opening'; render();
  try {
    const next = await importArchive(file, message => { status = message; render(); }, selectedFormat);
    closeViewer(true); postViewerId = null; returnViewer = null; postViewerFocus = null; document.body.classList.remove('post-viewer-open'); disposeArchive(archive); archive = next; view = 'feed'; query = ''; visibleCount = 24; visibleMessages = 80; selectedAlbumId = null; selectedThreadId = null; status = '';
  } catch (cause) { status = ''; error = cause?.message || 'unknownError'; if (t(error) === error) error = 'unknownError'; }
  render();
  if (archive || error) animateContentIn();
}

window.addEventListener('dragover', event => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); });
window.addEventListener('drop', event => { if (event.dataTransfer?.files?.length) event.preventDefault(); });
window.addEventListener('keydown', event => {
  if (viewer) {
    if (event.key === 'Escape') closeViewer();
    else if (event.key === 'ArrowLeft') { event.preventDefault(); moveViewer(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); moveViewer(1); }
  } else if (postViewerId) {
    if (event.key === 'Escape') closePostViewer();
    else if (event.key === 'Tab') {
      const buttons = [...app.querySelectorAll('#post-viewer button:not(:disabled)')];
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
});
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
