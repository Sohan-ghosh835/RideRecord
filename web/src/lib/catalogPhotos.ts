import { SEED_CATALOG } from '../domain/catalogSeed';

// Every image in src/bike-photos is bundled at build time (inlined as a data URI for single-file builds).
const files = import.meta.glob('../bike-photos/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const credits = (import.meta.glob('../bike-photos/credits.json', { eager: true, import: 'default' }) as Record<string, Record<string, { credit?: string; url?: string }>>)['../bike-photos/credits.json'] ?? {};

const variantFiles = import.meta.glob('../bike-photos/*/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const variantList = (import.meta.glob('../bike-photos/variants.json', { eager: true, import: 'default' }) as Record<string, Record<string, { name: string; slug: string }[]>>)['../bike-photos/variants.json'] ?? {};

const byName = new Map<string, string>();
for (const [path, url] of Object.entries(files)) byName.set(path.split('/').pop()!.replace(/\.[a-z]+$/i, '').toLowerCase(), url);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const modelKey = (manufacturer: string, model: string) => slug(`${manufacturer} ${model}`);

export interface Colour { name: string; slug: string; url: string }

/** Colour variants for a catalog bike (by id, then by model name for shared generations). */
export function catalogColours(catalogId?: string, manufacturer?: string, model?: string): Colour[] {
  const keys = [catalogId, manufacturer && model ? modelKey(manufacturer, model) : undefined].filter(Boolean) as string[];
  for (const k of keys) {
    const list = variantList[k.toLowerCase()];
    if (list?.length) return list.map(c => ({ ...c, url: variantFiles[`../bike-photos/${k.toLowerCase()}/${c.slug}.webp`] })).filter(c => c.url);
  }
  return [];
}

/** Photo for a catalog id (or the chosen colour), falling back to a model-level image shared by all its generations. */
export function catalogPhoto(catalogId?: string, manufacturer?: string, model?: string, colour?: string): { url: string; key: string; credit?: string; creditUrl?: string } | undefined {
  if (colour) { const c = catalogColours(catalogId, manufacturer, model).find(x => x.name === colour); if (c) return { url: c.url, key: `${catalogId}/${c.slug}` }; }
  const keys = [catalogId, manufacturer && model ? modelKey(manufacturer, model) : undefined].filter(Boolean) as string[];
  for (const k of keys) {
    const url = byName.get(k.toLowerCase());
    if (url) return { url, key: k, credit: credits[k]?.credit, creditUrl: credits[k]?.url };
  }
  return undefined;
}

export function photoCoverage() {
  const rows = SEED_CATALOG.map(e => ({ id: e.id, label: `${e.manufacturer} ${e.model}${e.generation ? ' (' + e.generation + ')' : ''}`, has: !!catalogPhoto(e.id, e.manufacturer, e.model) }));
  return { total: rows.length, have: rows.filter(r => r.has).length, rows };
}
