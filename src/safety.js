// Content safety filter. Everything here is fail-closed: if a video has a
// signal we can't vouch for, it is dropped rather than shown.

// Terms matched as whole words/phrases against title, description, tags and
// channel name. Kept deliberately broad; a few false positives are an
// acceptable price for never surfacing adult or gory content.
export const BLOCKED_TERMS = [
  'nsfw', '18+', '18 plus', 'adults only', 'adult only', 'xxx', 'porn', 'porno',
  'pornography', 'onlyfans', 'only fans', 'fansly', 'nude', 'nudes', 'nudity',
  'naked', 'topless', 'sex', 'sexy', 'sexual', 'erotic', 'erotica', 'hentai',
  'fetish', 'lewd', 'strip club', 'stripper', 'striptease', 'camgirl', 'cam girl',
  'boudoir', 'lingerie', 'bikini try on', 'try on haul', 'thirst trap',
  'uncensored', 'explicit', 'gore', 'gory', 'graphic violence', 'graphic content',
  'disturbing', 'disturbing footage', 'bodycam', 'body cam',
  'public execution', 'beheading', 'decapitation', 'dismember', 'dismemberment', 'mutilation',
  'self harm', 'self-harm', 'suicide', 'murder footage', 'real death',
  'deaths caught on camera', 'shocking footage', 'car crash compilation',
  'autopsy', 'snuff', 'torture', 'massacre', 'shooting footage',
  'drug use', 'getting high', 'gambling', 'casino stream', 'slots stream',
  'mature audiences', 'viewer discretion',
];

// Twitch "content classification labels" – any of these hides the stream.
export const BLOCKED_TWITCH_LABELS = new Set([
  'MatureGame', 'SexualThemes', 'ViolentGraphic', 'Gambling',
  'DrugsIntoxication', 'ProfanityVulgarity',
]);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCKED_RE = new RegExp(
  // Custom boundaries so terms like "18+" (ending in a non-word char) still work.
  `(?:^|[^a-z0-9])(?:${BLOCKED_TERMS.map(escape).join('|')})(?=$|[^a-z0-9])`,
  'i',
);

/** Returns the first blocked term found in any of the given strings, or null. */
export function findBlockedTerm(...texts) {
  const haystack = texts.flat().filter(Boolean).join(' \n ').toLowerCase();
  const m = haystack.match(BLOCKED_RE);
  return m ? m[0].replace(/^[^a-z0-9]/, '') : null;
}

/**
 * Decide whether a normalized item (see providers) is safe to show.
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkItem(item) {
  if (item.ageRestricted) return { ok: false, reason: 'age-restricted by platform' };
  if (item.mature) return { ok: false, reason: 'marked mature by platform' };
  const badLabel = (item.labels || []).find((l) => BLOCKED_TWITCH_LABELS.has(l));
  if (badLabel) return { ok: false, reason: `content label: ${badLabel}` };
  const term = findBlockedTerm(item.title, item.description, item.tags, item.channelName, item.categoryName);
  if (term) return { ok: false, reason: `blocked term: ${term}` };
  return { ok: true };
}

export function filterSafe(items) {
  const safe = [];
  let removed = 0;
  for (const item of items) {
    if (checkItem(item).ok) safe.push(item);
    else removed++;
  }
  return { safe, removed };
}
