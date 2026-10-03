// Builds a personal "For You" ranking from the signals each platform exposes
// about the signed-in user (subscriptions, likes, follows) plus local watch
// history and "not interested" feedback.

const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {object} profile
 *   subscribedChannels: Set<string>   channel keys ("yt:UC..", "tw:123")
 *   likedChannels: Map<string, number> channel key -> like count
 *   categories: Map<string, number>    category key -> weight
 *   keywords: Map<string, number>      lowercase word -> weight
 *   watchedIds: Set<string>            item keys already watched here
 *   watchedChannels: Map<string, number>
 *   hiddenChannels: Set<string>
 */
export function scoreItem(item, profile, now = Date.now()) {
  if (profile.hiddenChannels?.has(item.channelKey)) return -Infinity;

  let score = 0;
  if (profile.subscribedChannels?.has(item.channelKey)) score += 3;
  score += Math.min(profile.likedChannels?.get(item.channelKey) || 0, 5) * 0.6;
  score += Math.min(profile.watchedChannels?.get(item.channelKey) || 0, 5) * 0.4;

  const maxCat = Math.max(1, ...(profile.categories?.values() || [1]));
  if (item.category) score += 2 * ((profile.categories?.get(item.category) || 0) / maxCat);

  if (profile.keywords?.size) {
    const words = tokenize(`${item.title} ${(item.tags || []).join(' ')}`);
    let hits = 0;
    for (const w of new Set(words)) hits += profile.keywords.get(w) || 0;
    score += Math.min(hits, 6) * 0.25;
  }

  if (item.live) score += 2.5;
  if (item.publishedAt) {
    const ageDays = Math.max(0, (now - new Date(item.publishedAt).getTime()) / DAY);
    score += 2 * Math.exp(-ageDays / 7);
  }
  if (item.views) score += Math.log10(item.views + 1) * 0.15;
  if (profile.watchedIds?.has(item.key)) score -= 4;

  return score;
}

/** Score, sort, and re-rank so one channel can't dominate the feed. */
export function rank(items, profile, { perChannelCap = 2, now = Date.now() } = {}) {
  const seen = new Set();
  const scored = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const s = scoreItem(item, profile, now);
    if (s !== -Infinity) scored.push({ item, score: s });
  }
  scored.sort((a, b) => b.score - a.score);

  // Greedy diversity pass: channels over the cap get pushed to the tail.
  const counts = new Map();
  const head = [];
  const tail = [];
  for (const entry of scored) {
    const n = counts.get(entry.item.channelKey) || 0;
    (n < perChannelCap ? head : tail).push(entry);
    counts.set(entry.item.channelKey, n + 1);
  }
  return [...head, ...tail].map((e) => ({ ...e.item, score: e.score }));
}

const STOP = new Set(('the a an and or of to in on for with is are was it this that my your ' +
  'i you we they he she at by from as be how what why when who official video new vs ft feat').split(' '));

export function tokenize(text) {
  return (text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Merge per-provider profile fragments into one profile. */
export function mergeProfiles(fragments, local = {}) {
  const profile = {
    subscribedChannels: new Set(),
    likedChannels: new Map(),
    categories: new Map(),
    keywords: new Map(),
    watchedIds: new Set(local.watchedIds || []),
    watchedChannels: new Map(Object.entries(local.watchedChannels || {})),
    hiddenChannels: new Set(local.hiddenChannels || []),
  };
  const add = (map, k, v) => map.set(k, (map.get(k) || 0) + v);
  for (const f of fragments) {
    f.subscribedChannels?.forEach((c) => profile.subscribedChannels.add(c));
    f.likedChannels?.forEach((v, k) => add(profile.likedChannels, k, v));
    f.categories?.forEach((v, k) => add(profile.categories, k, v));
    f.keywords?.forEach((v, k) => add(profile.keywords, k, v));
  }
  for (const [k, v] of Object.entries(local.watchedCategories || {})) add(profile.categories, k, v);
  return profile;
}
