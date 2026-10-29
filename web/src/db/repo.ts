import { VEHICLE_SCOPED, openRideDB, runAtomic, type RideDB, type StoreName, type VehicleStore } from './db';
import { collectReadings, lastKnownOdometer, type Reading } from '../domain/calc';
import { buildInitialTasks } from '../domain/maintenance';
import type {
  CatalogEntry, DocumentRec, Expense, FuelEntry, MaintenanceTask, OdometerReading, ServiceRecord, Suggestion, Vehicle, Removal,
} from '../domain/types';

export const newId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const nowIso = () => new Date().toISOString();

type Rec = { id: string; updatedAt: string; deletedAt?: string | null; vehicleId?: string; deletedWithVehicle?: boolean };

/** Insert or update. Stamps updatedAt and keeps createdAt. Stable ids make repeated saves idempotent. */
export async function save<T extends Rec>(store: StoreName, rec: T, db?: RideDB): Promise<T> {
  const d = db ?? (await openRideDB());
  const prev = (await d.get(store, rec.id)) as (T & { createdAt?: string }) | undefined;
  const out = { ...rec, createdAt: (rec as { createdAt?: string }).createdAt ?? prev?.createdAt ?? nowIso(), updatedAt: nowIso() };
  await d.put(store, out);
  return out;
}

export async function getOne<T>(store: StoreName, id: string, db?: RideDB): Promise<T | undefined> {
  return (await (db ?? (await openRideDB())).get(store, id)) as T | undefined;
}

/** Soft delete: the record stays in the database (Settings > Recently deleted) until purged on purpose. */
export async function softDelete(store: StoreName, id: string, db?: RideDB) {
  const d = db ?? (await openRideDB());
  const rec = (await d.get(store, id)) as Rec | undefined;
  if (rec) await d.put(store, { ...rec, deletedAt: nowIso(), updatedAt: nowIso() });
}
export async function restoreDeleted(store: StoreName, id: string, db?: RideDB) {
  const d = db ?? (await openRideDB());
  const rec = (await d.get(store, id)) as Rec | undefined;
  if (rec) await d.put(store, { ...rec, deletedAt: null, updatedAt: nowIso() });
}
export async function purge(store: StoreName, id: string, db?: RideDB) {
  await (db ?? (await openRideDB())).delete(store, id);
}

export async function listVehicleRecords<T extends Rec>(store: VehicleStore, vehicleId: string, opts: { includeDeleted?: boolean } = {}, db?: RideDB): Promise<T[]> {
  const d = db ?? (await openRideDB());
  const all = (await d.getAllFromIndex(store, 'vehicleId', vehicleId)) as T[];
  return opts.includeDeleted ? all : all.filter(r => !r.deletedAt);
}

export async function listVehicles(opts: { includeDeleted?: boolean } = {}, db?: RideDB): Promise<Vehicle[]> {
  const all = (await (db ?? (await openRideDB())).getAll('vehicles')) as Vehicle[];
  return (opts.includeDeleted ? all : all.filter(v => !v.deletedAt)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface VehicleBundle {
  vehicle: Vehicle;
  odometer: OdometerReading[];
  fuel: FuelEntry[];
  expenses: Expense[];
  services: ServiceRecord[];
  tasks: MaintenanceTask[];
  documents: Omit<DocumentRec, 'data'>[];
  readings: Reading[];
  lastOdo?: Reading;
}

export async function loadBundle(vehicleId: string, db?: RideDB): Promise<VehicleBundle | undefined> {
  const d = db ?? (await openRideDB());
  const vehicle = (await d.get('vehicles', vehicleId)) as Vehicle | undefined;
  if (!vehicle || vehicle.deletedAt) return undefined;
  const [odometer, fuel, expenses, services, tasks, documents] = await Promise.all([
    listVehicleRecords<OdometerReading>('odometer', vehicleId, {}, d),
    listVehicleRecords<FuelEntry>('fuel', vehicleId, {}, d),
    listVehicleRecords<Expense>('expenses', vehicleId, {}, d),
    listVehicleRecords<ServiceRecord>('services', vehicleId, {}, d),
    listVehicleRecords<MaintenanceTask>('tasks', vehicleId, {}, d),
    listVehicleRecords<DocumentRec>('documents', vehicleId, {}, d),
  ]);
  const readings = collectReadings(vehicle, odometer, fuel, services, expenses);
  return {
    vehicle, odometer, fuel: fuel.sort((a, b) => a.odometer - b.odometer), expenses, services: services.sort((a, b) => b.date.localeCompare(a.date)),
    tasks, documents: documents.map(({ data: _data, ...rest }) => rest), readings, lastOdo: lastKnownOdometer(readings),
  };
}

export async function getDocumentData(id: string, db?: RideDB): Promise<DocumentRec | undefined> {
  return getOne<DocumentRec>('documents', id, db);
}

/**
 * Create a vehicle plus its starting maintenance tasks in one transaction.
 * If anything fails, neither the vehicle nor any task is kept.
 */
export async function createVehicleWithTasks(
  vehicle: Vehicle, baseline: { odo?: number; date?: string }, queueReview: boolean, db?: RideDB,
): Promise<{ vehicle: Vehicle; tasks: MaintenanceTask[] }> {
  const d = db ?? (await openRideDB());
  const now = nowIso();
  const v: Vehicle = { ...vehicle, createdAt: vehicle.createdAt || now, updatedAt: now };
  const tasks = buildInitialTasks(v, baseline, now, newId);
  await runAtomic(d, ['vehicles', 'tasks', 'suggestions'], async tx => {
    await tx.objectStore('vehicles').put(v);
    for (const t of tasks) await tx.objectStore('tasks').put(t);
    if (queueReview) {
      const s: Suggestion = { id: newId(), kind: 'custom-vehicle', vehicleId: v.id, payload: { manufacturer: v.manufacturer, model: v.model, variant: v.variant, year: v.year, category: v.category, fuelType: v.fuelType, drive: v.drive, cooling: v.cooling }, status: 'pending', createdAt: now, updatedAt: now };
      await tx.objectStore('suggestions').put(s);
    }
  });
  return { vehicle: v, tasks };
}

/** Delete a vehicle and everything it owns (soft), atomically. */
export async function softDeleteVehicle(vehicleId: string, db?: RideDB, removal?: Omit<Removal, 'at'>) {
  const d = db ?? (await openRideDB());
  const stamp = nowIso();
  const stores: StoreName[] = ['vehicles', ...VEHICLE_SCOPED];
  await runAtomic(d, stores, async tx => {
    const v = (await tx.objectStore('vehicles').get(vehicleId)) as Vehicle | undefined;
    if (v) await tx.objectStore('vehicles').put({ ...v, deletedAt: stamp, updatedAt: stamp, ...(removal && (removal.reason || removal.rating || removal.note) ? { removal: { ...removal, at: stamp } } : {}) });
    for (const name of VEHICLE_SCOPED) {
      const idx = tx.objectStore(name).index('vehicleId');
      for (const r of (await idx.getAll(vehicleId)) as Rec[]) {
        // children deleted earlier on their own are left alone; the marker records which ones went with the vehicle
        if (!r.deletedAt) await tx.objectStore(name).put({ ...r, deletedAt: stamp, deletedWithVehicle: true, updatedAt: stamp });
      }
    }
  });
}

export async function restoreVehicle(vehicleId: string, db?: RideDB) {
  const d = db ?? (await openRideDB());
  const stores: StoreName[] = ['vehicles', ...VEHICLE_SCOPED];
  await runAtomic(d, stores, async tx => {
    const v = (await tx.objectStore('vehicles').get(vehicleId)) as Vehicle | undefined;
    if (!v) return;
    { const { removal: _r, ...keep } = v; await tx.objectStore('vehicles').put({ ...keep, deletedAt: null, updatedAt: nowIso() }); }
    // restore only children that were deleted together with the vehicle, not ones the owner deleted earlier
    for (const name of VEHICLE_SCOPED) {
      const idx = tx.objectStore(name).index('vehicleId');
      for (const r of (await idx.getAll(vehicleId)) as Rec[]) {
        if (r.deletedAt && r.deletedWithVehicle) {
          const { deletedWithVehicle: _flag, ...rest } = r;
          await tx.objectStore(name).put({ ...rest, deletedAt: null, updatedAt: nowIso() });
        }
      }
    }
  });
}

/** Save a service record. Completing a task never edits or removes earlier service events; next-due is derived from the newest one. */
export async function saveService(rec: ServiceRecord, db?: RideDB): Promise<ServiceRecord> {
  return save<ServiceRecord>('services', rec, db);
}

export async function listDeleted(db?: RideDB) {
  const d = db ?? (await openRideDB());
  const rows: { store: StoreName; id: string; label: string; deletedAt: string; vehicleId?: string; removal?: Removal }[] = [];
  for (const v of (await d.getAll('vehicles')) as Vehicle[]) if (v.deletedAt) rows.push({ store: 'vehicles', id: v.id, label: `Vehicle: ${v.manufacturer} ${v.model} ${v.year}`, deletedAt: v.deletedAt, removal: v.removal });
  const vehicles = new Map(((await d.getAll('vehicles')) as Vehicle[]).map(v => [v.id, v]));
  const vname = (id?: string) => { const v = id ? vehicles.get(id) : undefined; return v ? `${v.manufacturer} ${v.model}` : 'unknown vehicle'; };
  for (const store of VEHICLE_SCOPED) {
    for (const r of (await d.getAll(store)) as (Rec & Record<string, unknown>)[]) {
      if (!r.deletedAt) continue;
      if (r.deletedWithVehicle) continue; // comes back together with its vehicle
      const label = store === 'fuel' ? `Fuel entry ${r.date} (${vname(r.vehicleId)})`
        : store === 'expenses' ? `Expense ${r.date} ${r.category} (${vname(r.vehicleId)})`
        : store === 'services' ? `Service ${r.date} (${vname(r.vehicleId)})`
        : store === 'odometer' ? `Odometer ${r.km} km on ${r.date} (${vname(r.vehicleId)})`
        : store === 'documents' ? `Document ${r.title} (${vname(r.vehicleId)})`
        : `Task ${r.name} (${vname(r.vehicleId)})`;
      rows.push({ store, id: r.id, label, deletedAt: r.deletedAt as string, vehicleId: r.vehicleId });
    }
  }
  return rows.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// ---- catalog overlay & suggestions ----

export async function listOverlay(db?: RideDB): Promise<CatalogEntry[]> {
  return (await (db ?? (await openRideDB())).getAll('catalogOverlay')) as CatalogEntry[];
}
export async function putOverlay(entries: CatalogEntry[], db?: RideDB) {
  const d = db ?? (await openRideDB());
  await runAtomic(d, ['catalogOverlay'], async tx => { for (const e of entries) await tx.objectStore('catalogOverlay').put(e); });
}
export async function listSuggestions(db?: RideDB): Promise<Suggestion[]> {
  return ((await (db ?? (await openRideDB())).getAll('suggestions')) as Suggestion[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMeta<T = string>(key: string, db?: RideDB): Promise<T | undefined> {
  const r = (await (db ?? (await openRideDB())).get('meta', key)) as { key: string; value: T } | undefined;
  return r?.value;
}
export async function setMeta(key: string, value: unknown, db?: RideDB) {
  await (db ?? (await openRideDB())).put('meta', { key, value });
}
