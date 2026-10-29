import { SEED_CATALOG } from './catalogSeed';
import {
  CATEGORIES, FUEL_TYPES, SPEC_KEYS,
  type CatalogEntry, type Cooling, type DriveType, type ModelStatus, type SourceKind, type SourceRef, type SpecKey,
  type SpecValue, type Verification,
} from './types';

const VERIFICATIONS: Verification[] = ['verified', 'seed-unverified', 'estimated', 'user-entered'];
const DRIVES: DriveType[] = ['chain', 'belt', 'shaft', 'electric', 'unknown'];
const COOLINGS: Cooling[] = ['air', 'oil', 'liquid', 'unknown'];
const STATUSES: ModelStatus[] = ['current', 'discontinued', 'historical'];
const SOURCE_KINDS: SourceKind[] = ['manufacturer', 'manual', 'distributor', 'third-party', 'seed', 'user'];

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/g;
/** External content is untrusted: trim, strip control characters and cap length. React renders it as text only. */
export function cleanText(v: unknown, max = 200): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || undefined;
}

function safeUrl(v: unknown): string | undefined {
  const s = cleanText(v, 500);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch { return undefined; }
}

export type EntryCheck = { ok: true; entry: CatalogEntry; warnings: string[] } | { ok: false; errors: string[] };

/** Validate and sanitise a catalog record that came from outside the app (import file or API). */
export function validateCatalogEntry(raw: unknown): EntryCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Record is not an object'] };
  const r = raw as Record<string, unknown>;
  const manufacturer = cleanText(r.manufacturer, 60);
  const model = cleanText(r.model, 80);
  if (!manufacturer) errors.push('manufacturer is required');
  if (!model) errors.push('model is required');
  const yearFrom = Number(r.yearFrom);
  if (!Number.isInteger(yearFrom) || yearFrom < 1900 || yearFrom > 2100) errors.push('yearFrom must be a year between 1900 and 2100');
  let yearTo: number | null = null;
  if (r.yearTo !== null && r.yearTo !== undefined) {
    yearTo = Number(r.yearTo);
    if (!Number.isInteger(yearTo) || yearTo < yearFrom || yearTo > 2100) errors.push('yearTo must be null or a year >= yearFrom');
  }
  const category = r.category as CatalogEntry['category'];
  if (!CATEGORIES.includes(category)) errors.push(`category must be one of: ${CATEGORIES.join(', ')}`);
  const fuelType = r.fuelType as CatalogEntry['fuelType'];
  if (!FUEL_TYPES.includes(fuelType)) errors.push(`fuelType must be one of: ${FUEL_TYPES.join(', ')}`);
  if (errors.length) return { ok: false, errors };

  const verification = VERIFICATIONS.includes(r.verification as Verification) ? (r.verification as Verification) : 'seed-unverified';
  const sources: SourceRef[] = [];
  if (Array.isArray(r.sources)) {
    for (const s of r.sources.slice(0, 10)) {
      if (!s || typeof s !== 'object') continue;
      const o = s as Record<string, unknown>;
      const label = cleanText(o.label, 160);
      if (!label) continue;
      sources.push({
        kind: SOURCE_KINDS.includes(o.kind as SourceKind) ? (o.kind as SourceKind) : 'third-party',
        label, url: safeUrl(o.url), retrieved: cleanText(o.retrieved, 10),
      });
    }
  }
  if (verification === 'verified' && !sources.some(s => s.kind === 'manufacturer' || s.kind === 'manual' || s.kind === 'distributor')) {
    warnings.push('Marked verified but has no manufacturer, manual or distributor source; downgraded to estimated.');
  }
  const specs: CatalogEntry['specs'] = {};
  if (r.specs && typeof r.specs === 'object') {
    for (const [k, v] of Object.entries(r.specs as Record<string, unknown>)) {
      if (!(SPEC_KEYS as string[]).includes(k) || !v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      const value = typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : cleanText(o.value, 120);
      if (value === undefined) { warnings.push(`spec ${k} dropped: invalid value`); continue; }
      const sv: SpecValue = {
        value, unit: cleanText(o.unit, 16), original: cleanText(o.original, 120),
        verification: VERIFICATIONS.includes(o.verification as Verification) ? (o.verification as Verification) : verification,
        sourceIndex: Number.isInteger(o.sourceIndex) && (o.sourceIndex as number) < sources.length ? (o.sourceIndex as number) : undefined,
      };
      specs[k as SpecKey] = sv;
    }
  }
  const downgrade = verification === 'verified' && !sources.some(s => ['manufacturer', 'manual', 'distributor'].includes(s.kind));
  const idRaw = cleanText(r.id, 120) ?? `${manufacturer}-${model}-${cleanText(r.generation, 40) ?? ''}`;
  const entry: CatalogEntry = {
    id: idRaw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    manufacturer: manufacturer!, model: model!,
    family: cleanText(r.family, 60),
    aliases: Array.isArray(r.aliases) ? r.aliases.map(a => cleanText(a, 60)).filter((a): a is string => !!a).slice(0, 20) : [],
    generation: cleanText(r.generation, 60),
    variants: Array.isArray(r.variants) ? r.variants.map(a => cleanText(a, 60)).filter((a): a is string => !!a).slice(0, 30) : undefined,
    yearFrom, yearTo, market: cleanText(r.market, 8) ?? 'GLOBAL',
    category, fuelType,
    drive: DRIVES.includes(r.drive as DriveType) ? (r.drive as DriveType) : 'unknown',
    cooling: COOLINGS.includes(r.cooling as Cooling) ? (r.cooling as Cooling) : 'unknown',
    status: STATUSES.includes(r.status as ModelStatus) ? (r.status as ModelStatus) : yearTo === null ? 'current' : 'discontinued',
    specs, verification: downgrade ? 'estimated' : verification, sources,
    updatedAt: cleanText(r.updatedAt, 30) ?? new Date().toISOString(),
  };
  return { ok: true, entry, warnings };
}

/** Merge the bundled seed with imported overlay records. Overlay wins by id. */
export function mergeCatalog(overlay: CatalogEntry[]): CatalogEntry[] {
  const map = new Map<string, CatalogEntry>();
  for (const e of SEED_CATALOG) map.set(e.id, e);
  for (const e of overlay) map.set(e.id, e);
  return [...map.values()];
}

export interface Coverage {
  total: number;
  byVerification: Record<Verification, number>;
  byManufacturer: { manufacturer: string; total: number; verified: number }[];
  withoutSources: number;
}

export function catalogCoverage(catalog: CatalogEntry[]): Coverage {
  const byVerification: Record<Verification, number> = { verified: 0, 'seed-unverified': 0, estimated: 0, 'user-entered': 0 };
  const m = new Map<string, { total: number; verified: number }>();
  let withoutSources = 0;
  for (const e of catalog) {
    byVerification[e.verification]++;
    const x = m.get(e.manufacturer) ?? { total: 0, verified: 0 };
    x.total++;
    if (e.verification === 'verified') x.verified++;
    m.set(e.manufacturer, x);
    if (!e.sources.some(s => s.kind !== 'seed')) withoutSources++;
  }
  return {
    total: catalog.length, byVerification, withoutSources,
    byManufacturer: [...m.entries()].map(([manufacturer, v]) => ({ manufacturer, ...v })).sort((a, b) => b.total - a.total),
  };
}

/** Find likely duplicates: same manufacturer + normalised model + overlapping years + same generation. */
export function findDuplicates(catalog: CatalogEntry[]): [CatalogEntry, CatalogEntry][] {
  const out: [CatalogEntry, CatalogEntry][] = [];
  const key = (e: CatalogEntry) => `${e.manufacturer}|${e.model}|${e.generation ?? ''}`.toLowerCase().replace(/[^a-z0-9|]/g, '');
  const groups = new Map<string, CatalogEntry[]>();
  for (const e of catalog) {
    const k = key(e);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) out.push([g[i], g[j]]);
  }
  return out;
}
