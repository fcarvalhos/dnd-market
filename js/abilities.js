// Built-in abilities that can sway a market check, plus the homebrew JSON importer.
// Effect shape used by the engine:
//   { kind, timing: 'passive' | 'pre' | 'reactive', skills?: [skill | ability | 'checks'], ...kind fields }
//   kinds: prof{level} flat{value} die{die} minRoll{value,requiresProf} rerollOnes advantage
//          portent reroll extraD20 set20{value}

import { SKILLS, num } from './engine.js';

const CHA_SKILLS = ['persuasion', 'deception'];

export const BUILTIN = [
  {
    id: 'guidance', name: 'Guidance', source: 'Cantrip (you or an ally)', cost: 0, max: null,
    desc: 'Add 1d4 to the check. Cast before rolling, so it costs nothing.',
    effects: () => [{ kind: 'die', die: 4, timing: 'pre' }],
  },
  {
    id: 'enhance', name: 'Enhance Ability', source: 'Spell (2nd level)', cost: 3, max: 1, usesLabel: 'slots',
    desc: 'Advantage on CHA (Eagle\'s Splendor) or INT (Fox\'s Cunning) checks. Cast before the check.',
    effects: () => [{ kind: 'advantage', timing: 'pre', skills: ['cha', 'int'] }],
  },
  {
    id: 'tides', name: 'Tides of Chaos', source: 'Wild Magic Sorcerer', cost: 2, max: 1,
    desc: 'Gain advantage on one d20 test, declared before rolling.',
    effects: () => [{ kind: 'advantage', timing: 'pre' }],
  },
  {
    id: 'portent', name: 'Portent', source: 'Divination Wizard', cost: 1, max: null,
    desc: 'Foretold d20s. The lowest one that guarantees success replaces the roll.',
    params: [{ key: 'values', label: 'Foretold rolls', type: 'text', placeholder: 'e.g. 17, 4' }],
    effects: () => [{ kind: 'portent', timing: 'pre' }],
  },
  {
    id: 'reliable', name: 'Reliable Talent', source: 'Rogue 7', cost: 0, max: null,
    desc: 'On a check with a proficient skill, a d20 of 9 or lower counts as 10.',
    effects: () => [{ kind: 'minRoll', value: 10, timing: 'passive', requiresProf: true }],
  },
  {
    id: 'silver', name: 'Silver Tongue', source: 'College of Eloquence', cost: 0, max: null,
    desc: 'On Persuasion or Deception, a d20 of 9 or lower counts as 10.',
    effects: () => [{ kind: 'minRoll', value: 10, timing: 'passive', skills: CHA_SKILLS }],
  },
  {
    id: 'jack', name: 'Jack of All Trades', source: 'Bard 2', cost: 0, max: null,
    desc: 'Add half your proficiency bonus to checks you aren\'t proficient in.',
    effects: () => [{ kind: 'prof', level: 'half', timing: 'passive' }],
  },
  {
    id: 'halfling', name: 'Halfling Luck', source: 'Halfling', cost: 0, max: null,
    desc: 'Reroll a natural 1 on the d20 (the new roll must be used).',
    effects: () => [{ kind: 'rerollOnes', timing: 'passive' }],
  },
  {
    id: 'bardic', name: 'Bardic Inspiration', source: 'Bard (yours or an ally\'s)', cost: 2, max: 1, usesLabel: 'dice',
    desc: 'After a failed roll, add the inspiration die.',
    params: [{ key: 'die', label: 'Die', type: 'select', options: [6, 8, 10, 12], default: 6 }],
    effects: (p) => [{ kind: 'die', die: num(p.die) || 6, timing: 'reactive' }],
  },
  {
    id: 'flash', name: 'Flash of Genius', source: 'Artificer 7 (you or an ally)', cost: 2, max: 1,
    desc: 'Reaction: add the artificer\'s INT modifier to the check.',
    params: [{ key: 'int', label: 'Artificer INT', type: 'number', placeholder: 'your INT' }],
    effects: (p, ch) => [{ kind: 'flat', value: p.int === '' || p.int == null ? num(ch.mods?.int) : num(p.int), timing: 'reactive' }],
  },
  {
    id: 'tactical', name: 'Tactical Mind', source: 'Fighter 2 (2024)', cost: 2, max: 2, usesLabel: 'Second Wind',
    desc: 'After a failed check, add 1d10. If it still fails, the use isn\'t expended.',
    effects: () => [{ kind: 'die', die: 10, timing: 'reactive', refundOnFail: true }],
  },
  {
    id: 'lucky', name: 'Lucky', source: 'Origin feat', cost: 3, max: (ch) => Math.max(1, num(ch.prof)), usesLabel: 'luck pts',
    desc: 'Spend a Luck Point to roll another d20 and keep the higher one. Doesn\'t stack with advantage.',
    effects: () => [{ kind: 'extraD20', timing: 'reactive' }],
  },
  {
    id: 'heroic', name: 'Heroic Inspiration', source: 'Human / DM award', cost: 3, max: 1,
    desc: 'Reroll the d20 right after rolling and use the new roll.',
    effects: () => [{ kind: 'reroll', timing: 'reactive' }],
  },
  {
    id: 'stroke', name: 'Stroke of Luck', source: 'Rogue 20', cost: 6, max: 1,
    desc: 'Turn a failed d20 roll into a 20. Used only as a last resort.',
    effects: () => [{ kind: 'set20', value: 20, timing: 'reactive' }],
  },
];

export const defaultMax = (def, ch) => (typeof def.max === 'function' ? def.max(ch) : def.max);

// ---------- Homebrew import ----------

const KNOWN_TARGETS = new Set([...Object.keys(SKILLS), 'cha', 'int', 'wis', 'checks']);
const LEVEL_MAP = { proficient: 'prof', proficiency: 'prof', prof: 'prof', expertise: 'expert', expert: 'expert', half: 'half' };

function targetsOf(e) {
  if (Array.isArray(e.skills)) return e.skills.map((s) => String(s).toLowerCase());
  if (typeof e.skills === 'string') return [e.skills.toLowerCase()];
  if (e.target === 'checks' || e.on === 'checks' || e.what === 'checks') return e.key && e.key !== 'all' ? [String(e.key).toLowerCase()] : null;
  if (['skill', 'check'].includes(e.target) || ['skill', 'check'].includes(e.on) || ['skill', 'check'].includes(e.what)) return e.key ? [String(e.key).toLowerCase()] : null;
  if (e.target || e.on || e.what) return false; // targets something unrelated (ac, damage, saves…)
  return null; // no target given → all checks
}

const relevant = (t) => t === null || t.some((s) => KNOWN_TARGETS.has(s));

/** Convert one JSON effect (this app's format or dnd-sheet's) to engine effects. Returns [] if irrelevant. */
export function normalizeEffect(e) {
  if (!e || typeof e !== 'object') return [];
  const type = String(e.type || '').toLowerCase();
  const skills = targetsOf(e);
  if (skills === false || !relevant(skills)) return [];
  const base = { skills: skills || undefined };
  const timing = ['passive', 'pre', 'reactive'].includes(e.timing) ? e.timing : null;
  const dieMatch = typeof e.value === 'string' && e.value.match(/^1?d(\d+)$/i);
  switch (type) {
    case 'bonus':
      if (dieMatch) return [{ ...base, kind: 'die', die: Number(dieMatch[1]), timing: timing || 'passive', refundOnFail: !!e.refundOnFail }];
      return [{ ...base, kind: 'flat', value: typeof e.value === 'number' ? e.value : String(e.value || 0).toLowerCase(), timing: timing || 'passive' }];
    case 'advantage':
      return [{ ...base, kind: 'advantage', timing: timing === 'reactive' ? 'pre' : timing || (e.uses ? 'pre' : 'passive') }];
    case 'reroll':
      return [{ ...base, kind: e.keep === 'best' || e.keep === 'higher' ? 'extraD20' : 'reroll', timing: 'reactive' }];
    case 'min-roll': case 'minroll': case 'min_roll':
      return [{ ...base, kind: 'minRoll', value: num(e.value) || 10, timing: 'passive', requiresProf: !!(e.requiresProficiency ?? e.requiresProf) }];
    case 'proficiency': {
      const level = LEVEL_MAP[String(e.level || 'proficient').toLowerCase()] || 'prof';
      return [{ ...base, kind: 'prof', level, timing: 'passive' }];
    }
    case 'set-roll': case 'setroll':
      return [{ ...base, kind: 'set20', value: num(e.value) || 20, timing: 'reactive' }];
    case 'reroll-ones': case 'rerollones':
      return [{ ...base, kind: 'rerollOnes', timing: 'passive' }];
    default:
      return [];
  }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entry';

/** Parse an uploaded JSON file. Accepts {entries:[...]}, a bare array, or a single entry object. */
export function parseHomebrew(json, fileName = 'upload.json') {
  let entries = Array.isArray(json) ? json : Array.isArray(json?.entries) ? json.entries : json && json.name ? [json] : null;
  if (!entries) throw new Error('No "entries" array found. See the example file for the format.');
  const out = [];
  const warnings = [];
  const recognized = [];
  const seen = new Set();
  entries.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || !entry.name) { warnings.push(`Entry #${i + 1} has no name and was skipped.`); return; }
    const builtin = BUILTIN.find((b) => b.name.toLowerCase() === String(entry.name).toLowerCase());
    const raw = Array.isArray(entry.effects) ? entry.effects : [];
    const effects = raw.flatMap(normalizeEffect);
    if (builtin && !effects.length) { recognized.push(builtin.id); return; }
    let id = slug(entry.name);
    while (seen.has(id)) id += '-x';
    seen.add(id);
    const usesRaw = entry.uses ?? raw.find((e) => e && e.uses != null)?.uses;
    const hasActive = effects.some((e) => e.timing !== 'passive');
    out.push({
      id, kind: entry.kind || 'feature', name: String(entry.name), summary: entry.summary || entry.description || '',
      effects, ignored: raw.length - effects.length,
      max: hasActive && usesRaw != null ? Math.max(0, num(usesRaw)) : null,
      cost: num(entry.cost ?? (hasActive ? 2 : 0)),
    });
  });
  return { source: json?.source || fileName.replace(/\.json$/i, ''), fileName, entries: out, warnings, recognized };
}

const SK = (e) => (e.skills ? e.skills.map((s) => (SKILLS[s] ? s[0].toUpperCase() + s.slice(1) : s.toUpperCase())).join('/') : 'all checks');
const WHEN = { passive: 'always', pre: 'before the roll', reactive: 'after a failed roll' };

export function describeEffect(e) {
  switch (e.kind) {
    case 'flat': return `${typeof e.value === 'number' && e.value >= 0 ? '+' : ''}${typeof e.value === 'number' ? e.value : `+${String(e.value).toUpperCase()}`} to ${SK(e)} (${WHEN[e.timing]})`;
    case 'die': return `+1d${e.die} to ${SK(e)} (${WHEN[e.timing]})`;
    case 'advantage': return `Advantage on ${SK(e)} (${WHEN[e.timing]})`;
    case 'prof': return `${{ prof: 'Proficiency', expert: 'Expertise', half: 'Half proficiency' }[e.level]} in ${SK(e)}`;
    case 'minRoll': return `d20 below ${e.value} counts as ${e.value} on ${SK(e)}${e.requiresProf ? ' (if proficient)' : ''}`;
    case 'reroll': return `Reroll the d20 on ${SK(e)}`;
    case 'extraD20': return `Roll an extra d20 on ${SK(e)}, keep the best`;
    case 'set20': return `Turn a failed d20 into ${e.value || 20}`;
    case 'rerollOnes': return 'Reroll natural 1s';
    case 'portent': return 'Replace the d20 with a foretold roll';
    default: return e.kind;
  }
}
