import { BRAND_ALIASES } from './catalogSeed';
import type { CatalogEntry, Category, FuelType } from './types';

export interface SearchFilters {
  manufacturer?: string;
  year?: number;
  category?: Category;
  fuelType?: FuelType;
}

export interface SearchHit {
  entry: CatalogEntry;
  score: number; // 0..1, internal
  label: 'exact' | 'likely' | 'possible';
  yearMatched: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  /** True when the app must ask the rider to choose instead of auto-selecting. */
  needsConfirmation: boolean;
  /** Plain-language explanation of why confirmation is needed. */
  explanation?: string;
  parsed: { year?: number; wantsOld: boolean; wantsCurrent: boolean; tokens: string[] };
}

export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[''`]/g, '').replace(/[^a-z0-9.+ ]+/g, ' ').replace(/(^|\s)\.+|\.+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Optimal-string-alignment distance: counts a transposition ("acitva") as one edit. */
export function editDistance(a: string, b: string): number {
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
}

const STOP = new Set(['the', 'a', 'an', 'my', 'i', 'have', 'bike', 'motorcycle', 'motorbike', 'model', 'of', 'for', 'and']);
const OLD_WORDS = new Set(['old', 'older', 'previous', 'prev', 'discontinued', 'classic-era', 'legacy', 'earlier']);
const NEW_WORDS = new Set(['new', 'newest', 'latest', 'current']);
const isNumeric = (t: string) => /^[0-9]+$/.test(t);

/** Score one query token against a set of entry tokens. Numeric tokens must match exactly. */
function tokenScore(q: string, tokens: string[]): number {
  let best = 0;
  for (const t of tokens) {
    if (t === q) return 1;
    if (isNumeric(q) || isNumeric(t)) continue;
    if (q.length >= 3 && t.startsWith(q)) best = Math.max(best, 0.9);
    else if (t.length >= 3 && q.startsWith(t) && q.length - t.length <= 1) best = Math.max(best, 0.8);
    const dist = editDistance(q, t);
    if (q.length >= 4 && dist <= 1) best = Math.max(best, 0.8);
    else if (q.length >= 7 && dist <= 2) best = Math.max(best, 0.7);
  }
  return best;
}

const wordsOf = (s: string) => normalize(s).split(' ').filter(Boolean);

const indexCache = new WeakMap<CatalogEntry, string[]>();
function entryTokens(e: CatalogEntry): string[] {
  const cached = indexCache.get(e);
  if (cached) return cached;
  const toks = new Set<string>();
  const add = (s?: string) => s && wordsOf(s).forEach(w => toks.add(w));
  add(e.manufacturer); add(e.model); add(e.family); add(e.generation);
  e.aliases.forEach(add);
  e.variants?.forEach(add);
  (BRAND_ALIASES[e.manufacturer] ?? []).forEach(add);
  add(e.category.replace('-', ' '));
  if (e.category.includes('scooter')) toks.add('scooter');
  if (e.fuelType === 'electric') { toks.add('electric'); toks.add('ev'); }
  if (e.fuelType === 'petrol') toks.add('petrol');
  const arr = [...toks];
  indexCache.set(e, arr);
  return arr;
}

export function parseQuery(query: string) {
  const norm = normalize(query);
  let year: number | undefined;
  let wantsOld = false, wantsCurrent = false;
  const tokens: string[] = [];
  for (const w of norm.split(' ').filter(Boolean)) {
    if (/^(19|20)\d{2}$/.test(w) && !year) { year = Number(w); continue; }
    if (OLD_WORDS.has(w)) { wantsOld = true; continue; }
    if (NEW_WORDS.has(w)) { wantsCurrent = true; continue; }
    if (STOP.has(w)) continue;
    tokens.push(w);
  }
  return { year, wantsOld, wantsCurrent, tokens };
}

export const inYearRange = (e: CatalogEntry, year: number) =>
  year >= e.yearFrom && (e.yearTo === null || year <= e.yearTo);

export function searchCatalog(catalog: CatalogEntry[], query: string, filters: SearchFilters = {}, limit = 30): SearchResult {
  const parsed = parseQuery(query);
  const year = filters.year ?? parsed.year;
  let pool = catalog;
  if (filters.manufacturer) pool = pool.filter(e => e.manufacturer === filters.manufacturer);
  if (filters.category) pool = pool.filter(e => e.category === filters.category);
  if (filters.fuelType) pool = pool.filter(e => e.fuelType === filters.fuelType);

  const scored: SearchHit[] = [];
  for (const entry of pool) {
    const toks = entryTokens(entry);
    let score: number;
    if (parsed.tokens.length === 0) score = 0.5; // filters only
    else {
      const sum = parsed.tokens.reduce((acc, q) => acc + tokenScore(q, toks), 0);
      score = sum / parsed.tokens.length;
      // Penalise entries whose own model words the query never mentions (Hunter vs Hunter 350 Retro).
      const modelWords = wordsOf(entry.model);
      const unmatched = modelWords.filter(w => !parsed.tokens.some(q => tokenScore(q, [w]) >= 0.8)).length;
      score -= Math.min(0.12, unmatched * 0.04);
    }
    if (parsed.tokens.length && score < 0.5) continue;
    const yearMatched = year !== undefined && inYearRange(entry, year);
    if (year !== undefined) score += yearMatched ? 0.08 : -0.25;
    if (parsed.wantsOld && entry.status !== 'current') score += 0.06;
    if (parsed.wantsOld && entry.status === 'current') score -= 0.04;
    if (parsed.wantsCurrent && entry.status === 'current') score += 0.04;
    scored.push({ entry, score: Math.max(0, Math.min(1, score)), label: 'possible', yearMatched });
  }

  // When a year was requested, drop out-of-range entries unless nothing else matches.
  let hits = scored;
  if (year !== undefined && scored.some(h => h.yearMatched)) hits = scored.filter(h => h.yearMatched);
  hits.sort((a, b) => b.score - a.score || a.entry.manufacturer.localeCompare(b.entry.manufacturer) || a.entry.model.localeCompare(b.entry.model) || b.entry.yearFrom - a.entry.yearFrom);
  hits = hits.slice(0, limit);
  hits.forEach(h => { h.label = h.score >= 0.95 ? 'exact' : h.score >= 0.75 ? 'likely' : 'possible'; });

  let needsConfirmation = false;
  let explanation: string | undefined;
  if (hits.length === 0) {
    explanation = 'No catalog entry matches. You can create a custom profile instead.';
  } else if (parsed.tokens.length > 0) {
    const top = hits[0];
    const close = hits.filter(h => h.score >= top.score - 0.1);
    if (close.length > 1) {
      needsConfirmation = true;
      const sameModel = close.every(h => h.entry.model === top.entry.model);
      explanation = sameModel
        ? `${top.entry.manufacturer} ${top.entry.model} exists in ${close.length} generations or versions${year ? ' that overlap that year' : ''}. Pick the one you own so the right details are used.`
        : `${close.length} models match closely. Pick the one you own.`;
    } else if (top.score < 0.75) {
      needsConfirmation = true;
      explanation = 'This is the closest match we found, but it is not an exact name match. Please confirm it is your vehicle.';
    } else if (top.entry.variants?.length) {
      // Variant is chosen explicitly in the profile step; never guessed.
      explanation = undefined;
    }
  }
  return { hits, needsConfirmation, explanation, parsed: { ...parsed, year } };
}

export function manufacturers(catalog: CatalogEntry[]): string[] {
  return [...new Set(catalog.map(e => e.manufacturer))].sort((a, b) => a.localeCompare(b));
}

export interface ModelGroup { manufacturer: string; model: string; entries: CatalogEntry[] }
export function groupByModel(entries: CatalogEntry[]): ModelGroup[] {
  const map = new Map<string, ModelGroup>();
  for (const e of entries) {
    const k = `${e.manufacturer}|${e.model}`;
    if (!map.has(k)) map.set(k, { manufacturer: e.manufacturer, model: e.model, entries: [] });
    map.get(k)!.entries.push(e);
  }
  return [...map.values()].sort((a, b) => a.model.localeCompare(b.model, undefined, { numeric: true }));
}
