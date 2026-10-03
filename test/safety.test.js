import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkItem, findBlockedTerm, filterSafe } from '../src/safety.js';

const base = { title: 'Speedrun any% world record', description: '', tags: [], channelName: 'Gamer', labels: [] };

test('allows ordinary content', () => {
  assert.equal(checkItem(base).ok, true);
  assert.equal(findBlockedTerm('Sussex cricket highlights', 'Essex vs Middlesex'), null);
  assert.equal(findBlockedTerm('How to cook pasta'), null);
});

test('blocks adult and gore terms, including ones ending in symbols', () => {
  assert.equal(findBlockedTerm('NSFW reaction'), 'nsfw');
  assert.equal(findBlockedTerm('this video is 18+ only'), '18+');
  assert.equal(findBlockedTerm('Real GORE footage'), 'gore');
  assert.equal(checkItem({ ...base, tags: ['onlyfans'] }).ok, false);
  assert.equal(checkItem({ ...base, channelName: 'XXX clips' }).ok, false);
});

test('blocks platform age restrictions and mature labels', () => {
  assert.equal(checkItem({ ...base, ageRestricted: true }).ok, false);
  assert.equal(checkItem({ ...base, mature: true }).ok, false);
  assert.equal(checkItem({ ...base, labels: ['SexualThemes'] }).ok, false);
  assert.equal(checkItem({ ...base, labels: ['ViolentGraphic'] }).ok, false);
  assert.equal(checkItem({ ...base, categoryName: 'Slots' }).ok, true);
});

test('filterSafe counts removals', () => {
  const { safe, removed } = filterSafe([base, { ...base, title: 'nude beach' }]);
  assert.equal(safe.length, 1);
  assert.equal(removed, 1);
});
