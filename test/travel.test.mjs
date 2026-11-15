import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMiles, daysFor, applyDay, MI_PER_PX } from '../js/travel.js';

const trip = () => ({ method: 'riding', travelers: 2, mounts: 2, day: 0, total: 5, gp: 0, xp: 0, inspiration: 0, events: [],
  supplies: [{ k: 'food', name: 'Rações', qty: 10 }, { k: 'water', name: 'Água', qty: 1 }, { k: 'feed', name: 'Ração', qty: 10 }, { name: 'Corda', qty: 1 }] });

test('distance follows the map scale', () => {
  assert.equal(MI_PER_PX, 0.8);
  assert.equal(routeMiles([[0, 0], [300, 400], [300, 500]]), 480); // 600 px
  assert.equal(routeMiles([[5, 5]]), 0);
});
test('days round up', () => {
  assert.equal(daysFor(65, 32), 3);
  assert.equal(daysFor(64, 32), 2);
  assert.equal(daysFor(100, 0), 0);
});
test('a quiet day only eats supplies', () => {
  const t = trip();
  const e = applyDay(t, 3, 1);
  assert.equal(e.text, undefined);
  assert.deepEqual(t.supplies.map((s) => s.qty), [8, 0, 8, 1]);
  assert.deepEqual([t.day, t.total], [1, 5]);
});
test('events change the journey', () => {
  const t = trip();
  applyDay(t, 6, 1); assert.equal(t.total, 6); // delay
  applyDay(t, 8, 2); assert.equal(t.total, 5); // shortcut
  applyDay(t, 7, 1); assert.equal(t.gp, -20);
  applyDay(t, 7, 2); assert.equal(t.xp, 25);
  applyDay(t, 10, 2); assert.equal(t.inspiration, 1);
  applyDay(t, 6, 2); assert.equal(t.supplies[0].qty, 1); // 10 - 6 days * 2 = 0, then +1 ration
  assert.equal(t.day, 6);
});
test('a shortcut never ends the travel before today', () => {
  const t = { ...trip(), day: 4, total: 5 };
  applyDay(t, 8, 2);
  assert.deepEqual([t.day, t.total], [5, 5]);
});
