import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank, mergeProfiles, scoreItem } from '../src/ranker.js';
import { parseDuration } from '../src/providers/youtube.js';

const now = Date.parse('2026-10-01T00:00:00Z');
const item = (key, channelKey, extra = {}) => ({
  key, channelKey, title: 'video', tags: [], publishedAt: '2026-09-30T00:00:00Z', views: 1000, ...extra,
});

test('subscriptions and liked categories outrank random popular videos', () => {
  const profile = mergeProfiles([{
    subscribedChannels: new Set(['yt:sub']),
    categories: new Map([['yt:cat:20', 5]]),
  }]);
  const out = rank([
    item('a', 'yt:random', { views: 5_000_000 }),
    item('b', 'yt:sub'),
    item('c', 'yt:other', { category: 'yt:cat:20' }),
  ], profile, { now });
  assert.deepEqual(out.map((i) => i.key), ['b', 'c', 'a']);
});

test('hidden channels are removed and watched videos sink', () => {
  const profile = mergeProfiles([], { hiddenChannels: ['yt:bad'], watchedIds: ['w'] });
  const out = rank([item('x', 'yt:bad'), item('w', 'yt:a'), item('n', 'yt:b')], profile, { now });
  assert.deepEqual(out.map((i) => i.key), ['n', 'w']);
});

test('diversity cap pushes a third video from one channel below others', () => {
  const profile = mergeProfiles([{ subscribedChannels: new Set(['yt:s']) }]);
  const out = rank([item('1', 'yt:s'), item('2', 'yt:s'), item('3', 'yt:s'), item('4', 'yt:o')], profile, { now });
  assert.deepEqual(out.map((i) => i.key), ['1', '2', '4', '3']);
});

test('live streams get a boost', () => {
  const p = mergeProfiles([]);
  assert.ok(scoreItem(item('l', 'tw:1', { live: true }), p, now) > scoreItem(item('v', 'tw:1'), p, now));
});

test('parseDuration handles ISO 8601 durations', () => {
  assert.equal(parseDuration('PT4M13S'), 253);
  assert.equal(parseDuration('PT1H2M'), 3720);
  assert.equal(parseDuration('P1DT1S'), 86401);
});
