// YouTube provider: signs in with Google (read-only scope) and turns the
// user's subscriptions + liked videos into a profile and a candidate pool.
import { tokenize } from '../ranker.js';

const API = 'https://www.googleapis.com/youtube/v3';
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const TOKEN_KEY = 'free.yt.token';

export function createYouTube({ clientId, regionCode = 'US' }) {
  let token = loadToken();

  const api = async (path, params) => {
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (res.status === 401) { signOut(); throw new Error('YouTube session expired – sign in again.'); }
    if (!res.ok) throw new Error(`YouTube ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };

  function signIn() {
    return new Promise((resolve, reject) => {
      if (!clientId) return reject(new Error('Set youtube.clientId in config.js first.'));
      if (!window.google?.accounts?.oauth2) return reject(new Error('Google sign-in script failed to load.'));
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) return reject(new Error(resp.error_description || resp.error));
          token = { access_token: resp.access_token, expires_at: Date.now() + (resp.expires_in - 60) * 1000 };
          try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } catch {}
          resolve();
        },
        error_callback: (err) => reject(new Error(err?.message || 'Google sign-in was cancelled.')),
      });
      client.requestAccessToken();
    });
  }

  function signOut() {
    if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.access_token, () => {});
    token = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  }

  async function subscribedChannelIds(limit = 150) {
    const ids = [];
    let pageToken;
    do {
      const r = await api('subscriptions', { part: 'snippet', mine: 'true', maxResults: 50, order: 'relevance', pageToken });
      ids.push(...r.items.map((s) => s.snippet.resourceId.channelId));
      pageToken = r.nextPageToken;
    } while (pageToken && ids.length < limit);
    return ids.slice(0, limit);
  }

  async function recentUploads(channelIds, perChannel = 4) {
    const playlists = [];
    for (const batch of chunks(channelIds, 50)) {
      const r = await api('channels', { part: 'contentDetails', id: batch.join(','), maxResults: 50 });
      playlists.push(...r.items.map((c) => c.contentDetails.relatedPlaylists.uploads).filter(Boolean));
    }
    const results = await Promise.allSettled(playlists.map((playlistId) =>
      api('playlistItems', { part: 'contentDetails', playlistId, maxResults: perChannel })));
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value.items.map((i) => i.contentDetails.videoId) : []));
  }

  async function videoDetails(ids) {
    const out = [];
    for (const batch of chunks([...new Set(ids)], 50)) {
      const r = await api('videos', { part: 'snippet,contentDetails,statistics,status', id: batch.join(','), maxResults: 50 });
      out.push(...r.items);
    }
    return out;
  }

  async function load() {
    const [subs, liked] = await Promise.all([
      subscribedChannelIds(),
      api('videos', { part: 'snippet,contentDetails,statistics,status', myRating: 'like', maxResults: 50 })
        .then((r) => r.items).catch(() => []),
    ]);

    // Build the profile fragment from what YouTube knows about the user.
    const fragment = {
      subscribedChannels: new Set(subs.map((id) => `yt:${id}`)),
      likedChannels: new Map(),
      categories: new Map(),
      keywords: new Map(),
    };
    const bump = (m, k, v = 1) => m.set(k, (m.get(k) || 0) + v);
    for (const v of liked) {
      bump(fragment.likedChannels, `yt:${v.snippet.channelId}`);
      bump(fragment.categories, `yt:cat:${v.snippet.categoryId}`);
      for (const w of tokenize(`${v.snippet.title} ${(v.snippet.tags || []).join(' ')}`)) bump(fragment.keywords, w, 0.2);
    }

    // Candidate pool: recent uploads from subscriptions (most relevant first)
    // plus what's popular in the categories the user likes most.
    const topCats = [...fragment.categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k]) => k.replace('yt:cat:', ''));
    const [uploadIds, popular] = await Promise.all([
      recentUploads(subs.slice(0, 40)),
      Promise.allSettled([
        ...topCats.map((cat) => api('videos', { part: 'snippet,contentDetails,statistics,status', chart: 'mostPopular', videoCategoryId: cat, regionCode, maxResults: 25 })),
        ...(topCats.length ? [] : [api('videos', { part: 'snippet,contentDetails,statistics,status', chart: 'mostPopular', regionCode, maxResults: 50 })]),
      ]).then((rs) => rs.flatMap((r) => (r.status === 'fulfilled' ? r.value.items : []))),
    ]);

    const likedIds = new Set(liked.map((v) => v.id));
    const details = await videoDetails(uploadIds);
    const items = [...details, ...popular].filter((v) => !likedIds.has(v.id)).map(normalize).filter(Boolean);
    return { fragment, items };
  }

  async function search(q) {
    // safeSearch=strict is YouTube's own strictest filter; our filter runs on top.
    const r = await api('search', { part: 'id', q, type: 'video', safeSearch: 'strict', maxResults: 25, videoEmbeddable: 'true', regionCode });
    const details = await videoDetails(r.items.map((i) => i.id.videoId));
    return details.map(normalize).filter(Boolean);
  }

  return {
    id: 'youtube',
    name: 'YouTube',
    get signedIn() { return !!token && token.expires_at > Date.now(); },
    signIn, signOut, load, search,
  };
}

export function normalize(v) {
  if (!v?.snippet) return null;
  const s = v.snippet;
  if (v.status && v.status.embeddable === false) return null;
  if (v.status && v.status.privacyStatus && v.status.privacyStatus !== 'public' && v.status.privacyStatus !== 'unlisted') return null;
  const thumbs = s.thumbnails || {};
  return {
    key: `yt:${v.id}`,
    provider: 'youtube',
    id: v.id,
    title: s.title,
    description: s.description || '',
    tags: s.tags || [],
    thumbnail: (thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default || {}).url,
    channelName: s.channelTitle,
    channelKey: `yt:${s.channelId}`,
    category: s.categoryId ? `yt:cat:${s.categoryId}` : null,
    publishedAt: s.publishedAt,
    views: Number(v.statistics?.viewCount || 0),
    duration: v.contentDetails?.duration ? parseDuration(v.contentDetails.duration) : null,
    live: s.liveBroadcastContent === 'live',
    ageRestricted: v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted',
    mature: false,
    labels: [],
    embedUrl: `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&modestbranding=1`,
    url: `https://www.youtube.com/watch?v=${v.id}`,
  };
}

export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, sec] = m.map((x) => Number(x || 0));
  return d * 86400 + h * 3600 + min * 60 + sec;
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function loadToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
    return t && t.expires_at > Date.now() ? t : null;
  } catch { return null; }
}
