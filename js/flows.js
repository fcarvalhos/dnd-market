// The market activities: which checks each one needs, how they resolve, and what gets recorded.
import { resolveCheck, rarityOf, searchBonus, cloneResources, num, SKILL_LABEL } from './engine.js';

export const MODES = {
  buyMagic: { label: 'Buy Magic Item', short: 'Buy Item', icon: '🔮', blurb: 'Find a vendor for a magic item. Only Kingdom cities; Rare and above only on other planes.' },
  buyMaterials: { label: 'Buy Raw Materials', short: 'Buy Materials', icon: '⚒️', blurb: 'Find a supplier for crafting materials. The DC uses the rarity of the item you will craft.' },
  sellMagic: { label: 'Sell Magic Item', short: 'Sell Magic', icon: '💎', blurb: 'Find a buyer (once per day), then negotiate the price.' },
  sellMundane: { label: 'Sell Mundane Item', short: 'Sell Mundane', icon: '🗡️', blurb: 'Buyers are always around. Negotiate against DC 13.' },
  sellRaw: { label: 'Sell Raw Materials', short: 'Sell Materials', icon: '📦', blurb: 'Mundane materials sell for 100%; beat DC 15 for 150%. Magical materials sell like magic items.' },
};

const gp = (n) => `${Math.round(n * 100) / 100} GP`;
const payoutMult = (c) => (c.nat20 ? 1.5 : c.success ? 1 : 0.5);

export function isMagicSale(mode, form) {
  return mode === 'sellMagic' || (mode === 'sellRaw' && !!form.magical);
}

export function runFlow(mode, form, ctx, { rng = Math.random, simulate = false } = {}) {
  const base = { character: ctx.character, abilities: ctx.abilities, resources: ctx.resources, strategy: ctx.strategy, rng, simulate };
  const r = rarityOf(form.rarity);
  const value = num(form.value);

  if (mode === 'buyMagic' || mode === 'buyMaterials') {
    const sb = searchBonus(form.rarity, form.days, form.gp);
    const extraParts = sb.total ? [{ label: `Search bonus (${num(form.days)} days, ${num(form.gp)} GP)`, value: sb.total }] : [];
    const c = resolveCheck({ ...base, skills: ['persuasion'], dc: r.dc, extraParts, title: mode === 'buyMagic' ? 'Vendor search' : 'Supplier search' });
    let detail;
    if (c.success) {
      if (mode === 'buyMagic') {
        const price = num(form.price);
        const finalPrice = price ? price * (form.consumable ? 0.5 : 1) + num(form.basePrice) : null;
        detail = finalPrice != null
          ? `Asking price: ${gp(finalPrice)}${form.consumable ? ' (consumable, half price)' : ''}${num(form.basePrice) ? ` incl. ${gp(num(form.basePrice))} base item` : ''}.`
          : 'Price per the Sane Magic Market table, plus the cost of the base mundane item.';
        return { checks: [c], outcome: { success: true, tier: 'success', label: 'Vendor found!', detail, price: finalPrice } };
      }
      return { checks: [c], outcome: { success: true, tier: 'success', label: 'Supplier found!', detail: `${gp(num(form.amount))} of materials can be bought for crafting.` } };
    }
    return { checks: [c], outcome: { success: false, tier: 'fail', label: mode === 'buyMagic' ? 'No vendor found' : 'No supplier found', detail: 'You can\'t search for this item again for 30 days.' } };
  }

  if (isMagicSale(mode, form)) {
    const search = resolveCheck({ ...base, skills: ['persuasion', 'investigation'], dc: r.dc, title: 'Buyer search' });
    if (!search.success) {
      return { checks: [search], outcome: { success: false, tier: 'fail', label: 'No buyer found today', detail: 'Only one buyer search per day. Try again tomorrow.', payout: 0 } };
    }
    const nego = resolveCheck({ ...base, skills: ['persuasion', 'deception'], dc: r.dc, title: 'Negotiation' });
    const m = payoutMult(nego);
    return {
      checks: [search, nego],
      outcome: {
        success: true, tier: m === 1.5 ? 'great' : m === 1 ? 'success' : 'partial', payout: value * m,
        label: m === 1.5 ? 'Natural 20! Sold for 150%' : m === 1 ? 'Sold at full value' : 'Sold at half value',
        detail: `+${gp(value * m)} (${m * 100}% of ${gp(value)})`,
      },
    };
  }

  if (mode === 'sellMundane') {
    const c = resolveCheck({ ...base, skills: ['persuasion', 'deception'], dc: 13, title: 'Negotiation' });
    const m = payoutMult(c);
    return {
      checks: [c],
      outcome: {
        success: true, tier: m === 1.5 ? 'great' : m === 1 ? 'success' : 'partial', payout: value * m,
        label: m === 1.5 ? 'Natural 20! Sold for 150%' : m === 1 ? 'Sold at full value' : 'Sold at half value',
        detail: `+${gp(value * m)} (${m * 100}% of ${gp(value)})`,
      },
    };
  }

  // Mundane raw materials: 100% by default, DC 15 for 150%. A natural 20 adds nothing extra.
  const c = resolveCheck({ ...base, skills: ['persuasion', 'deception'], dc: 15, title: 'Negotiation' });
  const m = c.success ? 1.5 : 1;
  return {
    checks: [c],
    outcome: {
      success: true, tier: c.success ? 'great' : 'success', payout: value * m,
      label: c.success ? 'Sold for 150%' : 'Sold at full value',
      detail: `+${gp(value * m)} (${m * 100}% of ${gp(value)})`,
    },
  };
}

/** Monte Carlo odds for a whole activity, with resources shared across its checks. */
export function estimateFlow(mode, form, ctx, n = 2000) {
  const tiers = { great: 0, success: 0, partial: 0, fail: 0 };
  let ok = 0;
  let payout = 0;
  for (let i = 0; i < n; i++) {
    const res = runFlow(mode, form, { ...ctx, resources: cloneResources(ctx.resources) }, { simulate: true });
    tiers[res.outcome.tier]++;
    if (res.outcome.success) ok++;
    payout += res.outcome.payout || 0;
  }
  for (const k in tiers) tiers[k] /= n;
  return { p: ok / n, tiers, expected: payout / n };
}

// ---------- Records ----------

export function objectiveLines(mode, form) {
  const r = rarityOf(form.rarity);
  const name = form.itemName || '(unnamed)';
  switch (mode) {
    case 'buyMagic': {
      const sb = searchBonus(form.rarity, form.days, form.gp);
      return [
        ['Item', name], ['Rarity', `${r.label} (DC ${r.dc})${r.plane === 'other' ? ' · other plane' : ''}`],
        ['Search', `${num(form.days)} days, ${num(form.gp)} GP → +${sb.total}`],
        ...(form.consumable ? [['Consumable', 'Yes (half price)']] : []),
      ];
    }
    case 'buyMaterials': {
      const sb = searchBonus(form.rarity, form.days, form.gp);
      return [
        ['Materials', `${name} (${num(form.amount)} GP)`], ['Crafted item rarity', `${r.label} (DC ${r.dc})`],
        ['Search', `${num(form.days)} days, ${num(form.gp)} GP → +${sb.total}`],
      ];
    }
    case 'sellMagic':
      return [['Item', name], ['Rarity', `${r.label} (DC ${r.dc})`], ['Reference value', `${num(form.value)} GP`]];
    case 'sellMundane':
      return [['Item', name], ['Reference value', `${num(form.value)} GP`], ['DC', '13']];
    case 'sellRaw':
      return form.magical
        ? [['Materials', `${name} (magical)`], ['Rarity', `${r.label} (DC ${r.dc})`], ['Reference value', `${num(form.value)} GP`]]
        : [['Materials', `${name} (mundane)`], ['Reference value', `${num(form.value)} GP`], ['DC for 150%', '15']];
    default: return [];
  }
}

export function buildRecord(mode, form, character, result) {
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    date: form.date,
    mode,
    itemName: form.itemName || '',
    rarity: form.rarity,
    title: `${MODES[mode].label}: ${form.itemName || '(unnamed)'}`,
    character: character.name || 'Unnamed adventurer',
    player: character.player || '',
    objective: objectiveLines(mode, form),
    checks: result.checks.map((c) => ({
      title: c.title, skill: c.skill, dc: c.dc, dice: c.dice, kept: c.kept, advantage: c.advantage, forced: c.forced, set: c.set,
      minRoll: c.minRoll, parts: c.parts, total: c.total, success: c.success, nat20: c.nat20, used: c.used, steps: c.steps,
    })),
    outcome: result.outcome,
    discord: { status: 'none' },
  };
}

/** Plain-text record following the table's registration template (English). */
export function recordText(rec) {
  const L = [];
  const magicSale = rec.mode === 'sellMagic' || (rec.mode === 'sellRaw' && rec.objective.some(([, v]) => String(v).includes('(magical)')));
  const val = (k) => rec.objective.find(([a]) => a === k)?.[1] ?? '';
  const checkLines = (c) => [
    `- **Skill used:** ${SKILL_LABEL[c.skill]}`,
    `- **DC:** ${c.dc}`,
    `- **Check result:** ${c.total}${c.nat20 ? ' (natural 20)' : ''} (${c.success ? 'success' : 'failure'})`,
    ...(c.used.length ? [`- **Abilities used:** ${c.used.map((u) => `${u.name} (${u.detail})`).join('; ')}`] : []),
  ];
  if (magicSale) {
    L.push('### ✨ Magic items', `**Character:** ${rec.character}`, `**Item sold:** ${rec.itemName || '(unnamed)'}`,
      `**Rarity:** ${val('Rarity')}`, `**Reference value:** ${val('Reference value')}`, `**Attempt date:** ${rec.date}`, '',
      '### 1. Buyer search', ...checkLines(rec.checks[0]));
    if (rec.checks[1]) L.push('', '### 2. Negotiation', ...checkLines(rec.checks[1]), `- **Sale:** +${Math.round(rec.outcome.payout)} GP`);
  } else if (rec.mode === 'sellMundane' || rec.mode === 'sellRaw') {
    L.push('### ⚒️ Mundane items', `**Character:** ${rec.character}`, `**Item sold:** ${rec.itemName || '(unnamed)'}`,
      `**Total reference value:** ${val('Reference value')}`, '', ...checkLines(rec.checks[0]), `- **Result:** +${Math.round(rec.outcome.payout * 100) / 100} GP`);
  } else {
    L.push(`### ${rec.mode === 'buyMagic' ? '🔮 Magic item purchase' : '⚒️ Raw materials purchase'}`, `**Character:** ${rec.character}`);
    for (const [k, v] of rec.objective) L.push(`**${k}:** ${v}`);
    L.push(`**Attempt date:** ${rec.date}`, '', '### Vendor search', ...checkLines(rec.checks[0]), `- **Outcome:** ${rec.outcome.label}. ${rec.outcome.detail}`);
  }
  return L.join('\n');
}
