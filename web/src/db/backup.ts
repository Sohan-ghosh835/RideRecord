import { ALL_STORES, DB_VERSION, VEHICLE_SCOPED, openRideDB, runAtomic, type RideDB, type StoreName } from './db';
import type { DocumentRec } from '../domain/types';

export const BACKUP_FORMAT = 1;
const DATA_STORES: StoreName[] = ALL_STORES.filter(s => s !== 'meta');

export interface BackupFile {
  app: 'riderecord';
  format: number;
  schemaVersion: number;
  exportedAt: string;
  includesDocuments: boolean;
  counts: Record<string, number>;
  checksum: string; // SHA-256 of JSON.stringify(data)
  data: Record<string, unknown[]>;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Export everything, including soft-deleted records, so a restore can bring back what was recoverable. */
export async function exportBackup(opts: { includeDocuments?: boolean } = {}, db?: RideDB): Promise<BackupFile> {
  const d = db ?? (await openRideDB());
  const includeDocuments = opts.includeDocuments ?? true;
  const data: Record<string, unknown[]> = {};
  for (const store of DATA_STORES) {
    const rows = (await d.getAll(store)) as Record<string, unknown>[];
    if (store === 'documents') {
      data[store] = includeDocuments
        ? rows.map(r => ({ ...r, data: toBase64((r as unknown as DocumentRec).data) }))
        : rows.map(r => { const { data: _drop, ...meta } = r; return { ...meta, data: '', dataOmitted: true }; });
    } else data[store] = rows;
  }
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  return { app: 'riderecord', format: BACKUP_FORMAT, schemaVersion: DB_VERSION, exportedAt: new Date().toISOString(), includesDocuments: includeDocuments, counts, checksum: await sha256Hex(JSON.stringify(data)), data };
}

// ---------- Validation ----------

const isStr = (v: unknown) => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const optNum = (v: unknown) => v === undefined || v === null || isNum(v);

type Check = (r: Record<string, unknown>) => string | null;
const CHECKS: Record<string, Check> = {
  vehicles: r => (!isStr(r.manufacturer) || !isStr(r.model) ? 'missing manufacturer/model' : !isNum(r.year) ? 'bad year' : null),
  odometer: r => (!isDate(r.date) ? 'bad date' : !isNum(r.km) || (r.km as number) < 0 ? 'bad km' : null),
  fuel: r => (!isDate(r.date) ? 'bad date' : !isNum(r.odometer) ? 'bad odometer' : !isNum(r.quantity) || (r.quantity as number) <= 0 ? 'bad quantity' : !isNum(r.total) ? 'bad total' : r.kind !== 'fuel' && r.kind !== 'charge' ? 'bad kind' : null),
  expenses: r => (!isDate(r.date) ? 'bad date' : !isNum(r.amount) ? 'bad amount' : !isStr(r.category) ? 'bad category' : !optNum(r.odometer) ? 'bad odometer' : null),
  services: r => (!isDate(r.date) ? 'bad date' : !isStr(r.work) ? 'missing work' : !isNum(r.labourCost) || !isNum(r.partsCost) ? 'bad cost' : !Array.isArray(r.taskKeys) ? 'bad taskKeys' : null),
  tasks: r => (!isStr(r.key) || !isStr(r.name) ? 'missing key/name' : !optNum(r.intervalKm) || !optNum(r.intervalMonths) ? 'bad interval' : null),
  documents: r => (!isStr(r.title) || !isStr(r.fileName) ? 'missing title/file' : null),
  catalogOverlay: r => (!isStr(r.manufacturer) || !isStr(r.model) ? 'missing manufacturer/model' : null),
  suggestions: r => (!isStr(r.kind) ? 'missing kind' : null),
};

export type ParseResult = { ok: true; file: BackupFile; warnings: string[] } | { ok: false; error: string };

/** Parse and verify a backup file's structure and checksum without touching the database. */
export async function parseBackup(text: string): Promise<ParseResult> {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'This file is not valid JSON, so it cannot be a RideRecord backup.' }; }
  const f = raw as Partial<BackupFile>;
  if (!f || f.app !== 'riderecord' || typeof f.data !== 'object' || !f.data) return { ok: false, error: 'This is not a RideRecord backup file.' };
  if (typeof f.format !== 'number' || f.format > BACKUP_FORMAT) return { ok: false, error: `This backup uses a newer format (${f.format}). Update RideRecord to restore it.` };
  if (typeof f.schemaVersion === 'number' && f.schemaVersion > DB_VERSION) return { ok: false, error: `This backup was made by a newer version of the app (schema ${f.schemaVersion}).` };
  const warnings: string[] = [];
  for (const k of Object.keys(f.data)) if (!DATA_STORES.includes(k as StoreName)) warnings.push(`Ignoring unknown section "${k}".`);
  const checksum = await sha256Hex(JSON.stringify(f.data));
  if (checksum !== f.checksum) return { ok: false, error: 'The backup failed its integrity check (checksum mismatch). The file may be damaged or edited, so nothing was imported.' };
  if (f.includesDocuments === false) warnings.push('This backup was exported without document files; document entries will restore without their files.');
  return { ok: true, file: f as BackupFile, warnings };
}

// ---------- Preview & restore ----------

export type RestoreMode = 'add-only' | 'newer-wins';

export interface PreviewRow { store: string; id: string; label: string; reason?: string }
export interface StorePreview { store: string; total: number; add: number; identical: number; backupNewer: number; localNewer: number; invalid: number }
export interface RestorePreview {
  stores: StorePreview[];
  invalid: PreviewRow[];
  willWrite: number;
  /** Records that would be added or overwritten under the chosen mode. */
  toWrite: { store: StoreName; record: Record<string, unknown> }[];
}

const stamp = (r: Record<string, unknown>) => (typeof r.updatedAt === 'string' ? r.updatedAt : '');
const same = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a) === JSON.stringify(b);

export async function previewRestore(file: BackupFile, mode: RestoreMode, db?: RideDB): Promise<RestorePreview> {
  const d = db ?? (await openRideDB());
  const backupVehicleIds = new Set((file.data.vehicles ?? []).map(v => (v as { id?: string }).id));
  const localVehicleIds = new Set(((await d.getAllKeys('vehicles')) as string[]));
  const stores: StorePreview[] = [];
  const invalid: PreviewRow[] = [];
  const toWrite: RestorePreview['toWrite'] = [];

  for (const store of DATA_STORES) {
    const rows = (file.data[store] ?? []) as Record<string, unknown>[];
    const sp: StorePreview = { store, total: rows.length, add: 0, identical: 0, backupNewer: 0, localNewer: 0, invalid: 0 };
    for (const rec of rows) {
      const id = typeof rec?.id === 'string' ? rec.id : '';
      let problem: string | null = !id ? 'missing id' : (CHECKS[store]?.(rec) ?? null);
      if (!problem && (VEHICLE_SCOPED as readonly string[]).includes(store)) {
        const vid = rec.vehicleId as string;
        if (!isStr(vid)) problem = 'missing vehicleId';
        else if (!backupVehicleIds.has(vid) && !localVehicleIds.has(vid)) problem = 'refers to a vehicle that is not in the backup or on this device';
      }
      if (problem) { sp.invalid++; invalid.push({ store, id: id || '(none)', label: String(rec?.title ?? rec?.name ?? rec?.date ?? rec?.model ?? id), reason: problem }); continue; }
      const local = (await d.get(store, id)) as Record<string, unknown> | undefined;
      if (!local) { sp.add++; toWrite.push({ store, record: rec }); continue; }
      const cmpLocal = store === 'documents' ? { ...local, data: '' } : local;
      const cmpRec = store === 'documents' ? { ...rec, data: '' } : rec;
      if (same(cmpLocal, cmpRec)) { sp.identical++; continue; }
      if (stamp(rec) > stamp(local)) { sp.backupNewer++; if (mode === 'newer-wins') toWrite.push({ store, record: rec }); }
      else sp.localNewer++;
    }
    stores.push(sp);
  }
  return { stores, invalid, willWrite: toWrite.length, toWrite };
}

/**
 * Apply a previewed restore in ONE transaction: all records are written or none are.
 * Records are never deleted, and 'add-only' never overwrites an existing record.
 */
export async function applyRestore(preview: RestorePreview, db?: RideDB): Promise<{ written: number }> {
  const d = db ?? (await openRideDB());
  const stores = [...new Set(preview.toWrite.map(w => w.store))];
  if (!stores.length) return { written: 0 };
  await runAtomic(d, stores, async tx => {
    for (const { store, record } of preview.toWrite) {
      let rec = record;
      if (store === 'documents') {
        const dataStr = (record as { data?: unknown }).data;
        const omitted = (record as { dataOmitted?: boolean }).dataOmitted;
        const { dataOmitted: _o, ...rest } = record as Record<string, unknown>;
        rec = { ...rest, data: typeof dataStr === 'string' && dataStr && !omitted ? fromBase64(dataStr) : new ArrayBuffer(0) };
      }
      await tx.objectStore(store).put(rec);
    }
  });
  return { written: preview.toWrite.length };
}

export function backupFileName(now = new Date()) {
  return `riderecord-backup-${now.toISOString().slice(0, 10)}.json`;
}
