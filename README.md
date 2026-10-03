# free.

One feed for the videos and streams you already follow. **Free** adds no ads
of its own and filters out mature content.

Sign in with **YouTube** and/or **Twitch** (read-only). Free reads what those
platforms already know about you and uses it to build one ranked "For you"
feed and a "Live now" row:

| Signal | YouTube | Twitch |
| --- | --- | --- |
| Channels you subscribe to / follow | ✅ subscriptions | ✅ followed channels |
| Things you liked | ✅ liked videos (channels, categories, keywords) | – |
| What's live from people you follow | ✅ | ✅ |
| Discovery | Popular videos in your most-liked categories | Live streams in games your follows are playing |
| Watch history & "Not interested" | Stored locally in your browser | Stored locally in your browser |

## Safety filter (always on)

Everything is checked before it's shown, and anything unclear is dropped:

- YouTube **age-restricted** videos (`ytAgeRestricted`) are removed, and search uses `safeSearch=strict`.
- Twitch streams with any **content classification label** (Mature-rated game, Sexual Themes,
  Graphic Violence, Gambling, Drugs/Intoxication, Profanity) or the mature flag are removed.
  Streams whose labels can't be fetched are removed too.
- A keyword filter on titles, descriptions, tags, channel names and categories blocks
  NSFW, porn, nudity, gore, self-harm and similar terms (`src/safety.js`).

You can't turn the filter off in the app. No automatic filter is perfect, so if
something gets through, add the term to `BLOCKED_TERMS` in `src/safety.js`.

## What it can't do (and why)

- **Netflix, Disney+, Prime Video, Hulu, Max and similar services can't be included.** They
  have no public API, and their video is DRM-protected, so no third-party app can legally
  play their content or read your watch history from them.
- **Ads inside the platform's player.** Videos play in YouTube's and Twitch's official
  embedded players, as their terms require. Free shows no ads of its own, but YouTube or
  Twitch may still show theirs. A YouTube Premium or Twitch Turbo account removes them.
- **The platforms' internal recommendation algorithms aren't exposed.** YouTube's
  API no longer provides your home-feed recommendations, so Free rebuilds a
  recommender from the signals the APIs do give (see table above and `src/ranker.js`).

## Setup

You need your own (free) OAuth client IDs:

1. **YouTube:** in [Google Cloud Console](https://console.cloud.google.com/), create a project,
   enable the **YouTube Data API v3**, then create an **OAuth client ID** of type *Web
   application*. Add `http://localhost:8080` (and your real domain) under *Authorized
   JavaScript origins*. Add yourself as a test user on the OAuth consent screen.
2. **Twitch:** at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps), register an
   app with OAuth redirect URL `http://localhost:8080/` (and your real domain).
3. Put both IDs in `config.js`. Client IDs are public, so they aren't secrets.

Run it:

```sh
npm start        # serves on http://localhost:8080
npm test         # safety filter + ranker tests
```

It's a static site with no build step and no server, so you can deploy it to any static host
(GitHub Pages, Netlify, Cloudflare Pages). Add that domain to both OAuth configs.

## Layout

```
index.html, styles.css, config.js
src/app.js               UI, feed loading, player, search
src/providers/youtube.js Google sign-in, subscriptions, likes, uploads, search
src/providers/twitch.js  Twitch sign-in, follows, live streams, search
src/ranker.js            personal ranking + per-channel diversity
src/safety.js            content filter
test/                    node:test unit tests
```
