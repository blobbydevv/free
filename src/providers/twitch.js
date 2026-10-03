// Twitch provider: implicit-grant OAuth, then followed live channels plus
// live streams in the categories those channels are playing.

const API = 'https://api.twitch.tv/helix';
const TOKEN_KEY = 'free.tw.token';
const STATE_KEY = 'free.tw.state';

export function createTwitch({ clientId, redirectUri = location.origin + location.pathname }) {
  let token = loadToken();

  const api = async (path, params = {}) => {
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries(params)) {
      for (const val of [].concat(v)) if (val != null) url.searchParams.append(k, val);
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}`, 'Client-Id': clientId } });
    if (res.status === 401) { signOut(); throw new Error('Twitch session expired – sign in again.'); }
    if (!res.ok) throw new Error(`Twitch ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };

  function signIn() {
    if (!clientId) return Promise.reject(new Error('Set twitch.clientId in config.js first.'));
    const state = crypto.randomUUID();
    sessionStorage.setItem(STATE_KEY, state);
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'token',
      scope: 'user:read:follows', state,
    });
    location.assign(url);
    return new Promise(() => {}); // page navigates away
  }

  /** Call on page load to pick up the token Twitch puts in the URL hash. */
  function handleRedirect() {
    if (!location.hash.includes('access_token')) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    const ok = p.get('state') && p.get('state') === sessionStorage.getItem(STATE_KEY);
    history.replaceState(null, '', location.pathname + location.search);
    sessionStorage.removeItem(STATE_KEY);
    if (!ok) return false;
    // Implicit tokens last ~4h; we don't get expires_in, so assume 3h.
    token = { access_token: p.get('access_token'), expires_at: Date.now() + 3 * 3600 * 1000 };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    return true;
  }

  function signOut() {
    if (token) {
      fetch('https://id.twitch.tv/oauth2/revoke', {
        method: 'POST', body: new URLSearchParams({ client_id: clientId, token: token.access_token }),
      }).catch(() => {});
    }
    token = null;
    sessionStorage.removeItem(TOKEN_KEY);
  }

  async function withLabels(streams) {
    // Get Streams doesn't carry content classification labels; Get Channel Information does.
    const labels = new Map();
    for (let i = 0; i < streams.length; i += 100) {
      const ids = streams.slice(i, i + 100).map((s) => s.user_id);
      const r = await api('channels', { broadcaster_id: ids });
      for (const c of r.data) labels.set(c.broadcaster_id, c.content_classification_labels || []);
    }
    // A stream we couldn't get labels for is treated as unverified and dropped.
    return streams.filter((s) => labels.has(s.user_id)).map((s) => normalize(s, labels.get(s.user_id)));
  }

  async function load() {
    const me = (await api('users')).data[0];
    const [followed, followedLive] = await Promise.all([
      api('channels/followed', { user_id: me.id, first: 100 }).then((r) => r.data).catch(() => []),
      api('streams/followed', { user_id: me.id, first: 100 }).then((r) => r.data),
    ]);

    const fragment = {
      subscribedChannels: new Set(followed.map((f) => `tw:${f.broadcaster_id}`)),
      likedChannels: new Map(),
      categories: new Map(),
      keywords: new Map(),
    };
    for (const s of followedLive) {
      fragment.subscribedChannels.add(`tw:${s.user_id}`);
      fragment.categories.set(`tw:game:${s.game_id}`, (fragment.categories.get(`tw:game:${s.game_id}`) || 0) + 1);
    }

    const games = [...new Set(followedLive.map((s) => s.game_id).filter(Boolean))].slice(0, 5);
    const discover = games.length
      ? (await api('streams', { game_id: games, first: 40, type: 'live' })).data
      : (await api('streams', { first: 40, type: 'live' })).data;

    const items = await withLabels([...followedLive, ...discover]);
    return { fragment, items };
  }

  async function search(q) {
    const r = await api('search/channels', { query: q, live_only: 'true', first: 20 });
    if (!r.data.length) return [];
    const streams = (await api('streams', { user_id: r.data.map((c) => c.id), first: 20 })).data;
    return withLabels(streams);
  }

  return {
    id: 'twitch',
    name: 'Twitch',
    get signedIn() { return !!token && token.expires_at > Date.now(); },
    signIn, signOut, load, search, handleRedirect,
  };
}

export function normalize(s, labels = []) {
  return {
    key: `tw:${s.id}`,
    provider: 'twitch',
    id: s.user_login,
    title: s.title,
    description: '',
    tags: s.tags || [],
    thumbnail: (s.thumbnail_url || '').replace('{width}', '640').replace('{height}', '360'),
    channelName: s.user_name,
    channelKey: `tw:${s.user_id}`,
    category: s.game_id ? `tw:game:${s.game_id}` : null,
    categoryName: s.game_name,
    publishedAt: s.started_at,
    views: s.viewer_count || 0,
    duration: null,
    live: true,
    ageRestricted: false,
    mature: !!s.is_mature,
    labels,
    embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(s.user_login)}&parent=${location.hostname}&autoplay=true`,
    url: `https://www.twitch.tv/${s.user_login}`,
  };
}

function loadToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
    return t && t.expires_at > Date.now() ? t : null;
  } catch { return null; }
}
