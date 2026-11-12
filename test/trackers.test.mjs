import test from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, progress } from '../js/xp.js';
import { tier } from '../js/factions.js';

test('level thresholds', () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(299), 1);
  assert.equal(levelOf(300), 2);
  assert.equal(levelOf(355000), 20);
});
test('progress toward the next level', () => {
  assert.deepEqual(progress(600), { level: 2, pct: 50, toNext: 300, next: 900 });
  assert.equal(progress(400000).pct, 100);
});
test('reputation tiers', () => {
  assert.equal(tier(0), 'Neutral');
  assert.equal(tier(10), 'Friendly');
  assert.equal(tier(-100), 'Hated');
});
