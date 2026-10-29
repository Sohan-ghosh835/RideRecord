import { validateCatalogEntry } from '../domain/catalog';
import type { CatalogEntry } from '../domain/types';

export const API_URL: string | undefined = (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';

export type RemoteStatus =
  | { state: 'not-configured' }
  | { state: 'ok'; count: number }
  | { state: 'unavailable'; reason: string };

const cache = new Map<string, { at: number; entries: CatalogEntry[] }>();
const TTL = 5 * 60_000;

/**
 * Query the optional catalog service. Everything it returns is untrusted: each record is validated and sanitised,
 * failures degrade to the local catalog, and the rider can always create a manual profile.
 */
export async function remoteSearch(q: string, signal?: AbortSignal): Promise<{ entries: CatalogEntry[]; status: RemoteStatus }> {
  if (!API_URL) return { entries: [], status: { state: 'not-configured' } };
  const key = q.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { entries: hit.entries, status: { state: 'ok', count: hit.entries.length } };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { entries: [], status: { state: 'unavailable', reason: 'You are offline.' } };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(`${API_URL}/catalog/search?q=${encodeURIComponent(q)}&limit=30`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`The catalog service answered with status ${res.status}.`);
    const body = (await res.json()) as { results?: unknown[] };
    const entries: CatalogEntry[] = [];
    for (const raw of body.results ?? []) {
      const v = validateCatalogEntry(raw);
      if (v.ok) entries.push(v.entry);
    }
    cache.set(key, { at: Date.now(), entries });
    return { entries, status: { state: 'ok', count: entries.length } };
  } catch (e) {
    const reason = e instanceof DOMException && e.name === 'AbortError' ? 'The catalog service did not respond in time.' : e instanceof Error ? e.message : 'The catalog service could not be reached.';
    return { entries: [], status: { state: 'unavailable', reason } };
  } finally { clearTimeout(timer); }
}
