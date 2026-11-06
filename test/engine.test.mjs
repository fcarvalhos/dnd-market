import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchBonus, resolveCheck, staticModifier, cloneResources } from '../js/engine.js';
import { BUILTIN, parseHomebrew } from '../js/abilities.js';
import { runFlow, estimateFlow } from '../js/flows.js';

// rng that returns d20 faces in order (each value is the face for a d20; for other dice it's scaled)
const seq = (...faces) => { let i = 0; return () => { const f = faces[i++ % faces.length]; return (f - 0.5) / 20; }; };
const ch = (o = {}) => ({ name: 'T', mods: { int: 2, wis: 0, cha: 3 }, prof: 3, skills: { persuasion: 'prof', deception: 'none', investigation: 'none' }, misc: 0, ...o });
const ab = (id, extra = {}) => {
  const def = BUILTIN.find((b) => b.id === id);
  const params = { ...Object.fromEntries((def.params || []).map((p) => [p.key, p.default ?? ''])), ...(extra.params || {}) };
  return { id, name: def.name, cost: def.cost, enabled: true, uses: def.max == null ? null : 1, effects: def.effects(params, ch()), ...extra };
};
const res = (abs) => ({ uses: Object.fromEntries(abs.filter((a) => a.uses != null).map((a) => [a.id, a.uses])), portent: {} });

test('search bonus: base, extras and cap', () => {
  assert.equal(searchBonus('uncommon', 7, 100).total, 0);
  assert.equal(searchBonus('uncommon', 21, 400).total, 5);
  assert.equal(searchBonus('rare', 14, 200).total, 0);
  assert.equal(searchBonus('rare', 13, 200).valid, false);
  const big = searchBonus('common', 70, 2000);
  assert.equal(big.total, 10);
  assert.equal(big.capped, true);
});

test('static modifier with expertise via homebrew and Jack of All Trades', () => {
  const c = ch();
  assert.equal(staticModifier(c, [], 'persuasion').total, 6);
  assert.equal(staticModifier(c, [ab('jack')], 'deception').total, 4); // 3 + floor(3/2)
});

test('reliable talent floors only proficient skills', () => {
  const abs = [ab('reliable')];
  const r = resolveCheck({ character: ch(), abilities: abs, skills: ['persuasion'], dc: 16, resources: res(abs), rng: seq(2) });
  assert.equal(r.total, 16);
  assert.ok(r.success);
  const r2 = resolveCheck({ character: ch(), abilities: abs, skills: ['deception'], dc: 16, resources: res(abs), rng: seq(2) });
  assert.equal(r2.total, 5);
});

test('flash of genius used only on a fail and only if it flips it', () => {
  const abs = [ab('flash')];
  const resources = res(abs);
  const r = resolveCheck({ character: ch(), abilities: abs, skills: ['persuasion'], dc: 15, resources, rng: seq(8) });
  assert.equal(r.total, 16); // 8+6+2
  assert.equal(r.used[0].name, 'Flash of Genius');
  assert.equal(resources.uses.flash, 0);
  const resources2 = res(abs);
  const r2 = resolveCheck({ character: ch(), abilities: abs, skills: ['persuasion'], dc: 15, resources: resources2, rng: seq(12) });
  assert.equal(r2.used.length, 0);
  assert.equal(resources2.uses.flash, 1);
});

test('cheapest guaranteed reactive is used before Stroke of Luck', () => {
  const abs = [ab('stroke'), ab('flash')];
  const r = resolveCheck({ character: ch(), abilities: abs, skills: ['persuasion'], dc: 15, resources: res(abs), rng: seq(7) });
  assert.deepEqual(r.used.map((u) => u.id), ['flash']);
});

test('impossible DC keeps resources', () => {
  const abs = [ab('enhance'), ab('heroic')];
  const resources = res(abs);
  const r = resolveCheck({ character: ch(), abilities: abs, skills: ['persuasion'], dc: 30, resources, rng: seq(10) });
  assert.equal(r.success, false);
  assert.equal(resources.uses.enhance, 1);
  assert.equal(resources.uses.heroic, 1);
});

test('portent uses the lowest value that guarantees success', () => {
  const abs = [{ ...ab('portent') }];
  const resources = { uses: {}, portent: { portent: [18, 11, 3] } };
  const r = resolveCheck({ character: ch(), abilities: abs, skills: ['persuasion'], dc: 17, resources, rng: seq(1) });
  assert.equal(r.forced, 11);
  assert.deepEqual(resources.portent.portent, [18, 3]);
});

test('tactical mind is refunded if the check still fails', () => {
  const abs = [ab('tactical', { uses: 1 })];
  const resources = res(abs);
  const r = resolveCheck({ character: ch(), abilities: abs, skills: ['persuasion'], dc: 20, resources, rng: seq(2, 1) });
  assert.equal(r.success, false);
  assert.equal(resources.uses.tactical, 1);
});

test('mundane sale payouts', () => {
  const ctx = { character: ch(), abilities: [], resources: { uses: {}, portent: {} }, strategy: 'max' };
  assert.equal(runFlow('sellMundane', { value: 100 }, ctx, { rng: seq(20) }).outcome.payout, 150);
  assert.equal(runFlow('sellMundane', { value: 100 }, ctx, { rng: seq(1) }).outcome.payout, 50);
  assert.equal(runFlow('sellRaw', { value: 100, magical: false }, ctx, { rng: seq(20) }).outcome.payout, 150);
  assert.equal(runFlow('sellRaw', { value: 100, magical: false }, ctx, { rng: seq(1) }).outcome.payout, 100);
});

test('abilities raise the estimated odds', () => {
  const abs = [ab('guidance'), ab('enhance'), ab('lucky', { uses: 3 })];
  const ctx = { character: ch(), abilities: abs, resources: res(abs), strategy: 'max' };
  const base = estimateFlow('buyMagic', { rarity: 'rare', days: 14, gp: 200 }, { ...ctx, abilities: [] }, 3000).p;
  const boosted = estimateFlow('buyMagic', { rarity: 'rare', days: 14, gp: 200 }, ctx, 3000).p;
  assert.ok(boosted > base + 0.2, `${base} -> ${boosted}`);
  // estimation must not consume real resources
  assert.equal(ctx.resources.uses.enhance, 1);
});

test('homebrew import: own format, dnd-sheet format, builtin recognition', () => {
  const p = parseHomebrew({ entries: [
    { name: 'A', effects: [{ type: 'bonus', value: 2, skills: ['persuasion'] }, { type: 'bonus', target: 'ac', value: 1 }] },
    { name: 'B', effects: [{ type: 'proficiency', what: 'skill', key: 'deception', level: 'expertise' }] },
    { name: 'C', uses: 2, effects: [{ type: 'bonus', value: '1d6', timing: 'reactive' }] },
    { name: 'Lucky' },
  ] });
  assert.equal(p.entries.length, 3);
  assert.equal(p.entries[0].effects.length, 1);
  assert.equal(p.entries[0].ignored, 1);
  assert.equal(p.entries[1].effects[0].level, 'expert');
  assert.equal(p.entries[2].max, 2);
  assert.deepEqual(p.recognized, ['lucky']);
  assert.ok(cloneResources({ uses: { a: 1 } }).uses.a === 1);
});
