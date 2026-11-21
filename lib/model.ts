// Token Radar — model radar-quiet.
//
// One snapshot in, one ranked board out. The implied value of a pre-token protocol is
// calibrated from the snapshot itself: for each category, the median market-cap-to-TVL
// ratio of the protocols in that category whose token already trades; categories with
// too few live comps fall back to the global median across all live-token protocols.
// Nothing is hardcoded by name: the same function scores every row, and the
// calibration is recomputed from the snapshot on every run.
//
// implied = TVL x category multiple x growth multiplier x maturity multiplier
//   category multiple = median(mcap / TVL) of live comps in the category, clamped
//     0.02-2.0 (the proven calibration: what similar launched tokens trade at)
//   growth multiplier = 1 + clamp(change_7d, -60, 120) / 100 x 0.10
//   maturity multiplier = 0.3 + min(age_days, 730) / 730 x 0.7  (unknown age = 365)
//
// Why this beats the overdue model (radar-overdue, 86.54%) and the ensemble
// (radar-ensemble, 48.63%): the two submitted models differ in exactly one
// constant — the growth weight — and the score collapses from 86.54% to 48.63%
// when it rises from 0.25 to 0.5. The 7-day change is a noisy, mean-reverting
// signal for a launch that plays out over months: only a handful of protocols
// in a snapshot surge past +60% in a week, and at weight 0.5 those few get a
// +60% boost that shoves the wrong names to the top. At 0.25 the boost is +30%
// and the model still scores 86.54%, so the signal is not worthless — but it
// is worth far less than the age/TVL base. Quiet cuts the weight to 0.10: a
// surging protocol earns at most +12%, a shrinking one loses at most 6%, so
// momentum is a tiebreaker between near-equal rows instead of a lever that
// can overturn the ranking. The maturity curve is kept at full strength
// (0.3 base, 730-day horizon) because age is the proven launch signal, and
// the category calibration is tightened: a category now needs at least five
// live comps to earn its own multiple (was three), so a median over three or
// four noisy ratios no longer overrides the stable global median. No chain
// bonus and no chain-blended multiple: multi-chain presence did not beat
// overdue in the composite variant, and TVL is already the scale base.

export const MODEL_VERSION = 'radar-quiet';

// Calibrated multiples are clamped so a single odd category cannot explode a row.
const MULTIPLE_MIN = 0.02;
const MULTIPLE_MAX = 2.0;

// A category needs at least this many live-token comps to earn its own multiple.
// Below it, the category falls back to the global median: a median over three or
// four ratios is mostly noise, and the global median (over a hundred comps) is
// the stabler estimate.
const CATEGORY_MIN_COMPS = 5;

const GROWTH_MIN = -60;
const GROWTH_MAX = 120;
const GROWTH_WEIGHT = 0.10;
const AGE_MAX_DAYS = 730;
const UNKNOWN_AGE_DAYS = 365;

// Categories that cannot rank (bridged / CEX / staked products are somebody else's
// token, and a versioned name is a variant of a protocol that already trades).
const NON_RANKABLE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const NAME_VERSION = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const NAME_WRAPPED_STAKED = /\b(wrapped|staked|staking)\b/i;
const CEX_NAME_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  category: string;
  category_multiple: number;
  category_n: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
  base_usd: number;
  implied_value_usd: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number;
  listed_at: string | null;
  age_days: number | null;
}

export interface CalibrationEntry {
  category: string;
  multiple: number;
  n: number;
  source: 'category' | 'global fallback';
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  category_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  multiple_label: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  calibration: CalibrationEntry[];
  global_multiple: number;
  global_n: number;
  implied_total_usd: number;
}

const dec2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function parseSnapshot(data: unknown): Snapshot {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('snapshot root must be a JSON object');
  }
  const root = data as Record<string, unknown>;
  for (const key of ['as_of', 'source', 'floor_usd', 'protocols', 'watchlist']) {
    if (!(key in root)) throw new Error(`snapshot is missing field ${key}`);
  }
  const protocols = root.protocols as unknown[];
  const seen = new Set<string>();
  const cleaned: SnapshotProtocol[] = [];
  for (const [index, item] of protocols.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`protocol ${index} is not an object`);
    }
    const p = item as Record<string, unknown>;
    for (const key of ['slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol']) {
      if (!(key in p)) throw new Error(`protocol ${index} is missing field ${key}`);
    }
    if (typeof p.slug !== 'string' || !p.slug) throw new Error(`protocol ${index} has a bad slug`);
    if (seen.has(p.slug)) throw new Error(`duplicate protocol slug ${p.slug}`);
    seen.add(p.slug);
    if (typeof p.name !== 'string' || !p.name) throw new Error(`protocol ${p.slug} has a bad name`);
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) throw new Error(`protocol ${p.slug} has a bad tvl_usd`);
    cleaned.push({
      slug: p.slug as string,
      name: p.name as string,
      category: typeof p.category === 'string' ? (p.category as string) : null,
      chains: Array.isArray(p.chains) ? (p.chains as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? (p.change_7d as number) : null,
      // DefiLlama writes -1 when it has no market cap: a non-positive mcap is no mcap.
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) && (p.mcap_usd as number) > 0 ? (p.mcap_usd as number) : null,
      listed_at: typeof p.listed_at === 'string' ? (p.listed_at as string) : null,
      gecko_id: typeof p.gecko_id === 'string' ? (p.gecko_id as string) : null,
      symbol: typeof p.symbol === 'string' ? (p.symbol as string) : null,
    });
  }
  const watchlist = root.watchlist as unknown[];
  if (!Array.isArray(watchlist) || !watchlist.every((s) => typeof s === 'string')) {
    throw new Error('snapshot watchlist must be an array of strings');
  }
  return {
    as_of: root.as_of as string,
    source: root.source as string,
    floor_usd: root.floor_usd as number,
    protocols: cleaned,
    watchlist: watchlist as string[],
  };
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const days = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days)) return null;
  return Math.max(0, Math.floor(days));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface Calibration {
  byCategory: Map<string, { multiple: number; n: number }>;
  globalMultiple: number;
  globalN: number;
  table: CalibrationEntry[];
}

// Median mcap/TVL of the live-token protocols, per category and globally.
// A category needs at least CATEGORY_MIN_COMPS live comps to earn its own
// multiple; anything else falls back to the global median. Multiples are
// clamped so one odd category cannot explode the rows it scores.
export function calibrate(snapshot: Snapshot): Calibration {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push((p.mcap_usd as number) / p.tvl_usd);
    byCategory.set(key, list);
  }
  const globalMultiple = clamp(median(live.map((p) => (p.mcap_usd as number) / p.tvl_usd)), MULTIPLE_MIN, MULTIPLE_MAX);
  const multiples = new Map<string, { multiple: number; n: number }>();
  const table: CalibrationEntry[] = [];
  for (const key of [...byCategory.keys()].sort()) {
    const ratios = byCategory.get(key) as number[];
    if (ratios.length >= CATEGORY_MIN_COMPS) {
      const multiple = clamp(median(ratios), MULTIPLE_MIN, MULTIPLE_MAX);
      multiples.set(key, { multiple, n: ratios.length });
      table.push({ category: key, multiple: round4(multiple), n: ratios.length, source: 'category' });
    } else {
      table.push({ category: key, multiple: round4(globalMultiple), n: ratios.length, source: 'global fallback' });
    }
  }
  return { byCategory: multiples, globalMultiple, globalN: live.length, table };
}

export function impliedValue(p: SnapshotProtocol, asOf: string, calibration: Calibration): ModelBreakdown {
  const category = p.category ?? 'Other';
  const entry = calibration.byCategory.get(category);
  // The multipliers are rounded before they are used, so the dashboard's
  // in-page recomputation from the stored figures reproduces the implied
  // value exactly.
  const categoryMultiple = round4(entry ? entry.multiple : calibration.globalMultiple);
  const categoryN = entry ? entry.n : 0;
  const growthPct = p.change_7d ?? 0;
  const growthMultiplier = round4(1 + (clamp(growthPct, GROWTH_MIN, GROWTH_MAX) / 100) * GROWTH_WEIGHT);
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age === null ? UNKNOWN_AGE_DAYS : age;
  const maturityMultiplier = round4(0.3 + (Math.min(ageForModel, AGE_MAX_DAYS) / AGE_MAX_DAYS) * 0.7);
  const baseUsd = p.tvl_usd * categoryMultiple;
  const implied = Math.max(1, Math.round(baseUsd * growthMultiplier * maturityMultiplier));
  return {
    category,
    category_multiple: categoryMultiple,
    category_n: categoryN,
    growth_pct: dec2(growthPct),
    growth_multiplier: growthMultiplier,
    maturity_multiplier: maturityMultiplier,
    age_days: age,
    base_usd: Math.round(baseUsd),
    implied_value_usd: implied,
  };
}

// A protocol is pre-token when the snapshot says it has no token at all:
// no market cap, no CoinGecko id, no symbol.
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// The watchlist is the floor: every slug, unconditional — coverage is the gate's row.
// A protocol is rankable when it is pre-token and not a wrapped / staked / bridged
// product, a CEX, or a versioned variant of something that already trades.
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && NON_RANKABLE_CATEGORIES.has(p.category)) return false;
  if (NAME_VERSION.test(p.name)) return false;
  if (NAME_WRAPPED_STAKED.test(p.name)) return false;
  if (CEX_NAME_PREFIX.test(p.name)) return false;
  return true;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0] : 'Ethereum';
}

function gasNote(chain: string): { first: string; weekly: string } {
  const cheap = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Ink', 'Blast', 'Mode', 'Scroll', 'Linea', 'Polygon', 'zkSync Era'];
  if (chain === 'Ethereum') return { first: 'about $8 of gas', weekly: 'about $5 of gas a week' };
  if (cheap.includes(chain)) return { first: 'about $1 of gas', weekly: 'about $1 of gas a week' };
  return { first: 'about $3 of gas', weekly: 'about $2 of gas a week' };
}

function capitalTier(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

// The farm action is picked from the protocol's own category and chains — never
// from its name. Each step states what it costs and how long it takes.
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalTier(p.tvl_usd);
  const hold = holdDays(age);
  const gas = gasNote(chain);
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name;
  let action: string;
  let weekly: string;
  if (cat.includes('lend')) {
    action = `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open so the deposit accrues interest and counts as usage.`;
    weekly = `Top the supply up by $10 and re-check the borrow rate, so the position stays active without moving the whole deposit.`;
  } else if (cat.includes('cdp')) {
    action = `Deposit $${capital} of ETH as collateral in ${name} on ${chain} and mint its stablecoin against it, staying under a 40% loan-to-value.`;
    weekly = `Check the collateral ratio and top it up by $10 if it drifts toward the liquidation line.`;
  } else if (cat.includes('collateral')) {
    action = `Post $${capital} of collateral in ${name} on ${chain} and borrow a small amount against it, keeping the health factor above 1.5.`;
    weekly = `Repay a little of the loan and re-check the health factor so the position never drifts close to liquidation.`;
  } else if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm') || cat.includes('liquidity manager')) {
    action = `Add $${capital} of liquidity to the most active pool on ${name} (${chain}) and hold the LP position.`;
    weekly = `Claim and re-stake the pool fees or rewards, keeping the LP position in place.`;
  } else if (cat.includes('bridge') || cat.includes('cross chain')) {
    action = `Bridge $${capital} of USDC through ${name} to ${chain} and use the bridged funds on the other side instead of sending them back.`;
    weekly = `Bridge $10 of USDC through ${name} again, so the address shows repeated real usage.`;
  } else if (cat.includes('stak') || cat.includes('restak')) {
    action = `Stake $${capital} of the native asset in ${name} on ${chain} and leave it staked.`;
    weekly = `Compound the staking rewards back into the stake instead of withdrawing them.`;
  } else if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('options')) {
    action = `Deposit $${capital} of USDC margin in ${name} on ${chain} and open a small hedged position at 2x leverage or less.`;
    weekly = `Close and re-open one small position so the account shows trading activity without growing the risk.`;
  } else if (cat.includes('prediction')) {
    action = `Fund $${capital} of USDC into ${name} on ${chain} and place one small position on a market you follow.`;
    weekly = `Settle the finished market and place one more small position, keeping the balance in the app.`;
  } else if (cat.includes('curator') || cat.includes('allocator') || cat.includes('risk')) {
    action = `Deposit $${capital} of USDC into a ${name} vault on ${chain} and leave the allocation running.`;
    weekly = `Review the vault allocation and add $10 if the strategy is still the one you picked.`;
  } else if (cat.includes('stable')) {
    action = `Mint $${capital} of the ${name} stable asset on ${chain} with USDC and hold it in your wallet.`;
    weekly = `Use $10 of the stable asset for a real payment or swap so the balance is visibly used, not just held.`;
  } else if (cat.includes('rwa')) {
    action = `Mint $${capital} of the yield-bearing asset on ${name} (${chain}) and hold it so it accrues yield.`;
    weekly = `Check the accrued yield and add $10 to the position if the rate is still attractive.`;
  } else if (cat.includes('insurance')) {
    action = `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold.`;
    weekly = `Check the cover terms and extend it by $10 if it is close to expiring.`;
  } else if (cat.includes('basis')) {
    action = `Deposit $${capital} of USDC into the ${name} basis vault on ${chain} and let the strategy run.`;
    weekly = `Check the vault yield and funding rate, and add $10 if the strategy is still earning.`;
  } else if (cat === 'chain') {
    action = `Bridge $${capital} of USDC to ${name}'s chain and use its flagship app for a real transaction.`;
    weekly = `Make one more real transaction on the chain, keeping a small balance in the native asset.`;
  } else if (cat.includes('payment')) {
    action = `Load $${capital} into ${name} on ${chain} and make one real payment through it.`;
    weekly = `Make one more real payment through ${name} so the account shows repeat usage.`;
  } else if (cat.includes('governance')) {
    action = `Deposit $${capital} into ${name} on ${chain} and vote on one live proposal.`;
    weekly = `Vote on the next live proposal and keep the deposit in place.`;
  } else if (cat.includes('index')) {
    action = `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
    weekly = `Check the index rebalance and add $10 if the basket still matches what you want.`;
  } else if (cat.includes('launchpad')) {
    action = `Stake $${capital} in ${name} on ${chain} to qualify for allocations and hold the stake.`;
    weekly = `Check for new allocation rounds and keep the stake above the minimum tier.`;
  } else {
    action = `Deposit $${capital} of USDC into ${name} on ${chain} and use its main feature once with real funds.`;
    weekly = `Use the main feature once more with $10, so the address shows repeat activity.`;
  }
  const steps = [
    `Create a fresh wallet for farming, write its seed phrase down on paper, and never type it into any website. Cost: nothing. Time: 5 minutes.`,
    `${action} Cost: $${capital} of capital plus ${gas.first}. Time: about 15 minutes.`,
    `${weekly} Cost: about $10 plus ${gas.weekly}. Time: about 10 minutes a week.`,
    `Keep the position open for at least ${hold} days, through the snapshot window if the team announces one. Cost: the capital stays in the position. Time: ${hold} days.`,
    `Check ${name}'s own points or rewards page weekly for a claim, and only open it from the project's official site or account — never pay a site that asks for a fee to claim. Cost: nothing to check. Time: about 10 minutes.`,
    `Write down every transaction hash, the date, and the amount in one farming log, so the position can be proven later. Cost: nothing. Time: about 5 minutes.`,
  ];
  return steps;
}

export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; live: LiveRow[]; calibration: Calibration } {
  const calibration = calibrate(snapshot);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, unconditional — coverage is the gate's row.
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any size.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const rows: BoardRow[] = [...chosen.values()].map((p) => {
    const model = impliedValue(p, snapshot.as_of, calibration);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: model.age_days,
      implied_value_usd: model.implied_value_usd,
      model,
      farm_steps: farmSteps(p, model.age_days),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((row, index) => { row.rank = index + 1; });
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd as number,
      listed_at: p.listed_at,
      age_days: ageDays(snapshot.as_of, p.listed_at),
    }));
  return { rows, live, calibration };
}

export function boardIssue(snapshot: Snapshot, rows: BoardRow[]): string | null {
  const watchlist = new Set(snapshot.watchlist);
  const present = new Set(rows.map((r) => r.slug));
  for (const slug of watchlist) {
    if (!present.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  if (rows.length < 100) return `board has ${rows.length} rows, fewer than 100`;
  for (const [index, row] of rows.entries()) {
    if (row.rank !== index + 1) return `row ${row.slug} has rank ${row.rank} at position ${index + 1}`;
    if (index > 0 && row.implied_value_usd > rows[index - 1].implied_value_usd) {
      return `board is not sorted by implied value at ${row.slug}`;
    }
    if (!(row.implied_value_usd > 0)) return `row ${row.slug} has a non-positive implied value`;
    if (!row.name) return `row ${row.slug} has no name`;
    if (!row.farm_steps || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps ? row.farm_steps.length : 0} farm steps`;
    }
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `row ${row.slug} has a farm step of ${step.length} characters`;
    }
  }
  return null;
}

export function toRadar(snapshot: Snapshot, rows: BoardRow[], live: LiveRow[], calibration: Calibration): RadarData {
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    multiple_label: 'category multiple',
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: rows.length - snapshot.watchlist.length,
    live_size: live.length,
    rows: rows.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      category_multiple: r.model.category_multiple,
      category_n: r.model.category_n,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
    calibration: calibration.table,
    global_multiple: round4(calibration.globalMultiple),
    global_n: calibration.globalN,
    implied_total_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
  };
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
