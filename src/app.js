import { createYouTube } from './providers/youtube.js';
import { createTwitch } from './providers/twitch.js';
import { filterSafe } from './safety.js';
import { mergeProfiles, rank } from './ranker.js';

const config = window.FREE_CONFIG || {};
const providers = [
  createYouTube(config.youtube || {}),
  createTwitch(config.twitch || {}),
];
const twitch = providers.find((p) => p.id === 'twitch');

const $ = (id) => document.getElementById(id);
let profile = mergeProfiles([], loadLocal());
let feedItems = [];
let fragments = []; // platform-derived profile pieces from the last load

// ---------- local history (per-browser conveniences only) ----------
const LOCAL_KEY = 'free.local';
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { return {}; }
}
function saveLocal(mutate) {
  const local = loadLocal();
  local.watchedIds ||= [];
  local.watchedChannels ||= {};
  local.watchedCategories ||= {};
  local.hiddenChannels ||= [];
  mutate(local);
  local.watchedIds = local.watchedIds.slice(-500);
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch {}
  return local;
}

// ---------- accounts ----------
function renderAccounts() {
  const any = providers.some((p) => p.signedIn);
  $('welcome').hidden = any;
  $('accounts').hidden = !any;
  for (const host of [$('accounts'), $('connect')]) {
    host.replaceChildren(...providers.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `acct acct-${p.id}${p.signedIn ? ' on' : ''}`;
      b.textContent = p.signedIn ? `${p.name} ✓` : `Sign in with ${p.name}`;
      b.title = p.signedIn ? `Disconnect ${p.name}` : `Connect ${p.name}`;
      b.onclick = async () => {
        try {
          if (p.signedIn) p.signOut(); else await p.signIn();
          renderAccounts();
          loadFeed();
        } catch (e) { setStatus(e.message, true); }
      };
      return b;
    }));
  }
}

function setStatus(msg, isError = false) {
  $('status').textContent = msg || '';
  $('status').classList.toggle('error', isError);
}

// ---------- feed ----------
async function loadFeed() {
  const active = providers.filter((p) => p.signedIn);
  $('feed-title').textContent = 'For you';
  if (!active.length) {
    $('feed-section').hidden = true;
    $('live-section').hidden = true;
    setStatus('');
    return;
  }
  setStatus('Building your feed…');
  const results = await Promise.allSettled(active.map((p) => p.load()));
  const errors = [];
  fragments = [];
  const pool = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { fragments.push(r.value.fragment); pool.push(...r.value.items); }
    else errors.push(`${active[i].name}: ${r.reason.message}`);
  });
  renderAccounts();

  profile = mergeProfiles(fragments, loadLocal());
  const { safe, removed } = filterSafe(pool);
  feedItems = rank(safe, profile);

  render(feedItems);
  const notes = [];
  if (removed) notes.push(`${removed} item${removed === 1 ? '' : 's'} hidden by the safety filter`);
  if (errors.length) notes.push(...errors);
  setStatus(notes.join(' · '), errors.length > 0);
}

function render(items, { showLive = true } = {}) {
  const live = showLive ? items.filter((i) => i.live).slice(0, 12) : [];
  const liveKeys = new Set(live.map((i) => i.key));
  const rest = items.filter((i) => !liveKeys.has(i.key));

  $('live-section').hidden = !live.length;
  $('live').replaceChildren(...live.map(card));
  $('feed-section').hidden = false;
  $('feed').replaceChildren(...(rest.length ? rest.map(card) : [emptyNote()]));
}

function emptyNote() {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Nothing here yet. Subscribe to, follow or like a few things on your connected platforms and refresh.';
  return p;
}

function card(item) {
  const node = $('card-tpl').content.firstElementChild.cloneNode(true);
  node.querySelector('img').src = item.thumbnail || '';
  node.querySelector('.title').textContent = item.title;
  node.querySelector('.src').textContent = item.provider === 'youtube' ? 'YouTube' : 'Twitch';
  node.querySelector('.src').dataset.provider = item.provider;
  const badge = node.querySelector('.badge');
  if (item.live) { badge.textContent = 'LIVE'; badge.classList.add('live'); }
  else if (item.duration) badge.textContent = fmtDuration(item.duration);
  else badge.remove();
  const meta = [item.channelName];
  if (item.live) meta.push(`${fmtCount(item.views)} watching`);
  else {
    if (item.views) meta.push(`${fmtCount(item.views)} views`);
    if (item.publishedAt) meta.push(fmtAgo(item.publishedAt));
  }
  if (item.categoryName) meta.push(item.categoryName);
  node.querySelector('.meta').textContent = meta.join(' · ');
  node.onclick = () => play(item);
  return node;
}

// ---------- player ----------
let current = null;
function play(item) {
  current = item;
  $('player-frame').src = item.embedUrl;
  $('player-title').textContent = item.title;
  $('player-channel').textContent = item.channelName;
  $('player-open').href = item.url;
  $('player').showModal();
  saveLocal((l) => {
    if (!l.watchedIds.includes(item.key)) l.watchedIds.push(item.key);
    l.watchedChannels[item.channelKey] = (l.watchedChannels[item.channelKey] || 0) + 1;
    if (item.category) l.watchedCategories[item.category] = (l.watchedCategories[item.category] || 0) + 0.5;
  });
}
$('player').addEventListener('close', () => {
  $('player-frame').src = 'about:blank';
  // Re-rank with the new watch signal so the feed adapts as you go.
  profile = mergeProfiles(fragments, loadLocal());
  if ($('feed-title').textContent === 'For you') render(feedItems = rank(feedItems, profile));
});
$('player-close').onclick = () => $('player').close();
$('player-hide').onclick = () => {
  if (!current) return;
  saveLocal((l) => { if (!l.hiddenChannels.includes(current.channelKey)) l.hiddenChannels.push(current.channelKey); });
  feedItems = feedItems.filter((i) => i.channelKey !== current.channelKey);
  $('player').close();
};

// ---------- search ----------
$('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q) { render(feedItems); $('feed-title').textContent = 'For you'; return; }
  const active = providers.filter((p) => p.signedIn);
  if (!active.length) { setStatus('Sign in to a platform to search.', true); return; }
  setStatus(`Searching for “${q}”…`);
  const results = await Promise.allSettled(active.map((p) => p.search(q)));
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const { safe, removed } = filterSafe(items);
  $('feed-title').textContent = `Results for “${q}”`;
  render(rank(safe, profile, { perChannelCap: 3 }), { showLive: false });
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  setStatus([removed ? `${removed} result${removed === 1 ? '' : 's'} hidden by the safety filter` : '', ...errors].filter(Boolean).join(' · '), errors.length > 0);
});

// ---------- formatting ----------
function fmtCount(n) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
function fmtDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
function fmtAgo(iso) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, s] of units) if (sec >= s) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-Math.floor(sec / s), u);
  return 'just now';
}

// ---------- boot ----------
twitch.handleRedirect();
renderAccounts();
loadFeed();
