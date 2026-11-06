// Dice + rules engine. Pure functions: no DOM, rng is injectable so it can be tested.

export const SKILLS = { persuasion: 'cha', deception: 'cha', investigation: 'int' };
export const SKILL_LABEL = { persuasion: 'Persuasion', deception: 'Deception', investigation: 'Investigation' };
export const ABILITY_LABEL = { int: 'INT', wis: 'WIS', cha: 'CHA' };

export const RARITIES = [
  { key: 'common', label: 'Common', dc: 10, plane: 'material' },
  { key: 'uncommon', label: 'Uncommon', dc: 15, plane: 'material' },
  { key: 'rare', label: 'Rare', dc: 20, plane: 'other' },
  { key: 'veryRare', label: 'Very Rare', dc: 25, plane: 'other' },
  { key: 'legendary', label: 'Legendary', dc: 30, plane: 'other' },
];
export const rarityOf = (k) => RARITIES.find((r) => r.key === k) || RARITIES[1];

const LEVEL_RANK = { none: 0, half: 1, prof: 2, expert: 3 };

export const num = (x) => (x === '' || x == null || !Number.isFinite(Number(x)) ? 0 : Number(x));
const d = (rng, n) => 1 + Math.floor(rng() * n);
export const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** Search expense rules: base cost by plane, +1 per extra 7 days, +1 per extra 100 GP, capped at +10. */
export function searchBonus(rarityKey, days, gp) {
  const r = rarityOf(rarityKey);
  const baseDays = r.plane === 'material' ? 7 : 14;
  const baseGp = r.plane === 'material' ? 100 : 200;
  const dd = num(days);
  const gg = num(gp);
  const dayBonus = Math.max(0, Math.floor((dd - baseDays) / 7));
  const gpBonus = Math.max(0, Math.floor((gg - baseGp) / 100));
  const raw = dayBonus + gpBonus;
  return {
    baseDays, baseGp, dayBonus, gpBonus,
    total: Math.min(10, raw),
    capped: raw > 10,
    valid: dd >= baseDays && gg >= baseGp,
    plane: r.plane,
  };
}

export function effectApplies(effect, skill) {
  const s = effect.skills;
  if (!s || s.length === 0) return true;
  return s.includes('checks') || s.includes(skill) || s.includes(SKILLS[skill]);
}

export function resolveValue(v, character, pb) {
  if (typeof v === 'number') return v;
  if (character.mods && v in character.mods) return num(character.mods[v]);
  if (v === 'prof') return pb;
  if (v === 'half-prof') return Math.floor(pb / 2);
  return num(v);
}

/** Everything that is known before dice hit the table. */
export function staticModifier(character, abilities, skill) {
  const ab = SKILLS[skill];
  const pb = num(character.prof);
  const parts = [{ label: `${ABILITY_LABEL[ab]} modifier`, value: num(character.mods?.[ab]) }];
  let level = character.skills?.[skill] || 'none';
  let levelSrc = null;
  const flat = [];
  const dice = [];
  const minRolls = [];
  let rerollOnes = null;
  let passiveAdv = null;
  for (const a of abilities) {
    if (!a.enabled) continue;
    for (const e of a.effects || []) {
      if (e.timing !== 'passive' || !effectApplies(e, skill)) continue;
      if (e.kind === 'prof' && LEVEL_RANK[e.level] > LEVEL_RANK[level]) { level = e.level; levelSrc = a.name; }
      else if (e.kind === 'flat') flat.push({ label: a.name, value: resolveValue(e.value, character, pb) });
      else if (e.kind === 'die') dice.push({ label: a.name, die: e.die });
      else if (e.kind === 'minRoll') minRolls.push({ a, e });
      else if (e.kind === 'rerollOnes') rerollOnes = a.name;
      else if (e.kind === 'advantage') passiveAdv = a.name;
    }
  }
  const profValue = { none: 0, half: Math.floor(pb / 2), prof: pb, expert: pb * 2 }[level] || 0;
  if (profValue) {
    const name = level === 'expert' ? 'Expertise' : level === 'half' ? 'Half proficiency' : 'Proficiency';
    parts.push({ label: levelSrc ? `${name} (${levelSrc})` : name, value: profValue });
  }
  parts.push(...flat.filter((f) => f.value));
  if (num(character.misc)) parts.push({ label: 'Misc. bonus', value: num(character.misc) });

  let minRoll = 0;
  let minRollSrc = null;
  for (const { a, e } of minRolls) {
    if (e.requiresProf && LEVEL_RANK[level] < LEVEL_RANK.prof) continue;
    if (num(e.value) > minRoll) { minRoll = num(e.value); minRollSrc = a.name; }
  }
  return {
    parts, total: parts.reduce((s, p) => s + p.value, 0),
    level, minRoll, minRollSrc, rerollOnes, passiveAdv, dice,
  };
}

/** Chance of beating dc on a single d20 (or advantage) with a fixed bonus. */
export function pSingle(bonus, minRoll, dc, adv = false) {
  let c = 0;
  for (let f = 1; f <= 20; f++) if (Math.max(f, minRoll) + bonus >= dc) c++;
  const p = c / 20;
  return adv ? 1 - (1 - p) ** 2 : p;
}

export function cloneResources(r) {
  return {
    uses: { ...(r.uses || {}) },
    portent: Object.fromEntries(Object.entries(r.portent || {}).map(([k, v]) => [k, [...v]])),
  };
}

const hasUse = (a, res) => a.uses == null || (res.uses[a.id] ?? 0) > 0;
const spend = (a, res) => { if (a.uses != null) res.uses[a.id] = (res.uses[a.id] ?? 0) - 1; };
const refund = (a, res) => { if (a.uses != null) res.uses[a.id] = (res.uses[a.id] ?? 0) + 1; };

function effectsOf(abilities, timing, skill) {
  const out = [];
  for (const a of abilities) {
    if (!a.enabled) continue;
    for (const e of a.effects || []) if (e.timing === timing && effectApplies(e, skill)) out.push({ a, e });
  }
  return out;
}

const cost = (a) => num(a.cost);

function runSingle(o, skill) {
  const { character, abilities, dc, extraParts = [], resources: res, rng = Math.random, strategy = 'max', simulate } = o;
  const pb = num(character.prof);
  const st = staticModifier(character, abilities, skill);
  const steps = [];
  const used = [];
  const log = (s) => { if (!simulate) steps.push(s); };
  const parts = [...st.parts, ...extraParts.filter((p) => p.value)];
  let bonus = parts.reduce((s, p) => s + p.value, 0);
  const usedIds = new Set();
  const markUse = (a, detail) => { usedIds.add(a.id); spend(a, res); used.push({ id: a.id, name: a.name, detail }); };
  const minRoll = st.minRoll;

  for (const pd of st.dice) {
    const v = d(rng, pd.die);
    bonus += v;
    parts.push({ label: `${pd.label} (1d${pd.die})`, value: v, rolled: true });
  }

  const pre = effectsOf(abilities, 'pre', skill);
  const reactiveAll = effectsOf(abilities, 'reactive', skill);
  const reactiveMax = () => reactiveAll
    .filter(({ a }) => hasUse(a, res) && !usedIds.has(a.id))
    .reduce((s, { e }) => s + (e.kind === 'die' ? e.die : e.kind === 'flat' ? Math.max(0, resolveValue(e.value, character, pb)) : 0), 0);
  const guaranteed = () => Math.max(1, minRoll) + bonus >= dc;
  const impossible = () => 20 + bonus + reactiveMax() < dc;

  // 1. Free pre-roll help (e.g. Guidance) is always taken unless the check is already a sure thing.
  for (const { a, e } of pre) {
    if (cost(a) > 0 || usedIds.has(a.id) || !hasUse(a, res) || guaranteed()) continue;
    if (e.kind === 'die') {
      const v = d(rng, e.die);
      bonus += v;
      parts.push({ label: `${a.name} (1d${e.die})`, value: v, rolled: true });
      markUse(a, `+${v} (1d${e.die}) before the roll`);
      log(`✨ ${a.name} before the check: 1d${e.die} → +${v}`);
    } else if (e.kind === 'flat') {
      const v = resolveValue(e.value, character, pb);
      bonus += v;
      parts.push({ label: a.name, value: v });
      markUse(a, `${fmt(v)} before the roll`);
      log(`✨ ${a.name} before the check: ${fmt(v)}`);
    }
  }

  // 2. Portent: replace the d20 with the lowest foretold roll that still guarantees success.
  let forced = null;
  for (const { a, e } of pre) {
    if (e.kind !== 'portent' || forced != null || usedIds.has(a.id) || guaranteed()) continue;
    const arr = res.portent[a.id] || [];
    const v = [...arr].sort((x, y) => x - y).find((pv) => Math.max(pv, minRoll) + bonus >= dc);
    if (v != null) {
      forced = v;
      arr.splice(arr.indexOf(v), 1);
      usedIds.add(a.id);
      used.push({ id: a.id, name: a.name, detail: `foretold roll ${v} replaced the d20` });
      log(`🔮 ${a.name}: foretold roll ${v} replaces the d20 (enough for DC ${dc})`);
    }
  }

  let adv = st.passiveAdv ? st.passiveAdv : null;
  if (adv) log(`⚖️ Advantage from ${adv}`);
  let warnedImpossible = false;
  const shouldSpendPre = () => {
    if (forced != null || guaranteed()) return false;
    if (impossible()) {
      if (!warnedImpossible) log(`⛔ Even a natural 20 with every ability can't reach DC ${dc}, so pre-roll resources were kept.`);
      warnedImpossible = true;
      return false;
    }
    if (strategy === 'conserve') return pSingle(bonus, minRoll, dc, !!adv) < 0.5;
    return true;
  };

  // 3. Paid pre-roll help: advantage (cheapest source), then bonus dice.
  if (!adv && forced == null) {
    const advs = pre
      .filter(({ a, e }) => e.kind === 'advantage' && hasUse(a, res) && !usedIds.has(a.id))
      .sort((x, y) => cost(x.a) - cost(y.a));
    if (advs.length && (cost(advs[0].a) === 0 ? !guaranteed() : shouldSpendPre())) {
      const { a } = advs[0];
      adv = a.name;
      markUse(a, 'advantage on the check');
      log(`⚖️ ${a.name}: advantage on the check`);
    }
  }
  for (const { a, e } of pre) {
    if (cost(a) === 0 || usedIds.has(a.id) || !hasUse(a, res)) continue;
    if (e.kind !== 'die' && e.kind !== 'flat') continue;
    if (!shouldSpendPre()) continue;
    const v = e.kind === 'die' ? d(rng, e.die) : resolveValue(e.value, character, pb);
    bonus += v;
    parts.push({ label: e.kind === 'die' ? `${a.name} (1d${e.die})` : a.name, value: v, rolled: e.kind === 'die' });
    markUse(a, `${fmt(v)} before the roll`);
    log(`✨ ${a.name} before the check: ${e.kind === 'die' ? `1d${e.die} → ` : ''}${fmt(v)}`);
  }

  // 4. Roll.
  const rollD20 = () => {
    let v = d(rng, 20);
    if (v === 1 && st.rerollOnes) {
      const nv = d(rng, 20);
      log(`🍀 ${st.rerollOnes}: natural 1 rerolled → ${nv}`);
      v = nv;
    }
    return v;
  };
  let dice;
  if (forced != null) dice = [forced];
  else {
    dice = [rollD20()];
    if (adv) dice.push(rollD20());
  }
  let kept = Math.max(...dice);
  let set = null;
  const eff = () => set ?? Math.max(kept, minRoll);
  const total = () => eff() + bonus;
  if (forced == null) log(`🎲 d20${adv ? ' with advantage' : ''}: ${dice.join(' & ')}${adv ? ` → keep ${kept}` : ''}`);
  if (minRoll && kept < minRoll) log(`🛡️ ${st.minRollSrc}: the ${kept} counts as ${minRoll}`);
  log(`➕ Modifiers ${fmt(bonus)} → total ${total()} vs DC ${dc}`);

  // 5. Reactive help, only while the check is failing. Pick the option most likely to flip it,
  //    cheapest first on ties; if no single option can, spend the biggest swing toward a combination.
  const refundIfFail = [];
  while (total() < dc) {
    const cands = [];
    for (const { a, e } of reactiveAll) {
      if (usedIds.has(a.id) || !hasUse(a, res)) continue;
      let p = 0;
      let gain = 0;
      if (e.kind === 'reroll' || e.kind === 'extraD20') {
        if (set != null) continue;
        if (e.kind === 'extraD20' && adv) continue; // 2024 Lucky doesn't stack with advantage
        const floor = e.kind === 'extraD20' || dice.length > 1 ? kept : 0;
        let c = 0;
        for (let f = 1; f <= 20; f++) if (Math.max(Math.max(floor, f), minRoll) + bonus >= dc) c++;
        p = c / 20;
        gain = 20 - eff();
      } else if (e.kind === 'die') {
        let c = 0;
        for (let k = 1; k <= e.die; k++) if (total() + k >= dc) c++;
        p = c / e.die;
        gain = e.die;
      } else if (e.kind === 'flat') {
        const v = resolveValue(e.value, character, pb);
        if (v <= 0) continue;
        p = total() + v >= dc ? 1 : 0;
        gain = v;
      } else if (e.kind === 'set20') {
        const v = num(e.value) || 20;
        gain = v - eff();
        if (gain <= 0) continue;
        p = v + bonus >= dc ? 1 : 0;
      } else continue;
      cands.push({ a, e, p, gain });
    }
    if (!cands.length) break;
    cands.sort((x, y) => y.p - x.p || cost(x.a) - cost(y.a) || y.gain - x.gain);
    let pick = cands[0];
    if (pick.p === 0) {
      const replaceGain = Math.max(0, ...cands.filter((c) => ['reroll', 'extraD20', 'set20'].includes(c.e.kind)).map((c) => c.gain));
      const addGain = cands.filter((c) => c.e.kind === 'die' || c.e.kind === 'flat').reduce((s, c) => s + c.gain, 0);
      if (total() + replaceGain + addGain < dc) {
        log(`⛔ No combination of the remaining abilities can reach DC ${dc}; they were kept.`);
        break;
      }
      pick = [...cands].sort((x, y) => y.gain - x.gain || cost(x.a) - cost(y.a))[0];
    }
    const { a, e } = pick;
    if (e.kind === 'reroll') {
      const idx = dice.indexOf(Math.min(...dice));
      const old = dice[idx];
      const nv = rollD20();
      dice[idx] = nv;
      kept = Math.max(...dice);
      markUse(a, `rerolled ${old} → ${nv}`);
      log(`🔁 ${a.name}: rerolled the ${old} → ${nv}`);
    } else if (e.kind === 'extraD20') {
      const nv = rollD20();
      dice.push(nv);
      kept = Math.max(...dice);
      markUse(a, `extra d20 → ${nv}`);
      log(`🍀 ${a.name}: extra d20 → ${nv}, keeping ${kept}`);
    } else if (e.kind === 'die') {
      const v = d(rng, e.die);
      bonus += v;
      parts.push({ label: `${a.name} (1d${e.die})`, value: v, rolled: true });
      markUse(a, `+${v} (1d${e.die})`);
      if (e.refundOnFail) refundIfFail.push(a);
      log(`✨ ${a.name}: 1d${e.die} → +${v}`);
    } else if (e.kind === 'flat') {
      const v = resolveValue(e.value, character, pb);
      bonus += v;
      parts.push({ label: a.name, value: v });
      markUse(a, fmt(v));
      log(`💡 ${a.name}: ${fmt(v)}`);
    } else if (e.kind === 'set20') {
      set = num(e.value) || 20;
      markUse(a, `d20 treated as ${set}`);
      log(`🌟 ${a.name}: the d20 counts as a ${set}`);
    }
    log(`   → total ${total()} vs DC ${dc}`);
  }

  const success = total() >= dc;
  if (!success) {
    for (const a of refundIfFail) {
      refund(a, res);
      const u = used.find((x) => x.id === a.id);
      if (u) u.detail += ' (not expended: still failed)';
      log(`↩️ ${a.name} isn't expended because the check still failed`);
    }
  }
  return {
    skill, ability: SKILLS[skill], dc, dice, kept, advantage: adv, forced, set, minRoll: kept < minRoll && set == null ? minRoll : null,
    parts, bonus, total: total(), success, nat20: set == null && kept === 20, used, steps, level: st.level,
  };
}

export function estimateCheck(o, n = 600) {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const r = runSingle({ ...o, simulate: true, resources: cloneResources(o.resources) }, o.skills[0]);
    if (r.success) ok++;
  }
  return ok / n;
}

/**
 * Resolve one ability check. When several skills are allowed (e.g. Persuasion or Deception),
 * the one with the best estimated chance after abilities is used.
 */
export function resolveCheck(o) {
  const skills = o.skills;
  let skill = skills[0];
  let choice = null;
  if (skills.length > 1) {
    if (o.simulate) {
      let best = -1;
      for (const s of skills) {
        const st = staticModifier(o.character, o.abilities, s);
        const extra = (o.extraParts || []).reduce((a, p) => a + p.value, 0);
        const p = pSingle(st.total + extra, st.minRoll, o.dc, !!st.passiveAdv) + st.total / 1000;
        if (p > best) { best = p; skill = s; }
      }
    } else {
      const probs = skills.map((s) => ({ s, p: estimateCheck({ ...o, skills: [s] }, 500) }));
      probs.sort((a, b) => b.p - a.p);
      skill = probs[0].s;
      choice = probs;
    }
  }
  const r = runSingle(o, skill);
  if (choice) {
    r.steps.unshift(`🧭 Chose ${SKILL_LABEL[skill]} (≈${Math.round(choice[0].p * 100)}%) over ${choice.slice(1).map((c) => `${SKILL_LABEL[c.s]} (≈${Math.round(c.p * 100)}%)`).join(', ')}`);
  }
  r.alternatives = skills;
  r.title = o.title || '';
  return r;
}
