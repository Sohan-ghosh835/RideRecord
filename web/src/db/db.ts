import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';

/**
 * IndexedDB persistence with versioned migrations.
 *
 *  v1  vehicles, odometer, fuel, expenses, services, tasks, documents, meta
 *  v2  + catalogOverlay (imported verified catalog records), + suggestions (custom-vehicle review queue,
 *      spec-correction suggestions). Existing stores and data are untouched by the upgrade.
 *
 * Add a new `if (oldVersion < N)` block for every future schema change; never edit an old block.
 */
export const DB_NAME = 'riderecord';
export const DB_VERSION = 2;

export const VEHICLE_SCOPED = ['odometer', 'fuel', 'expenses', 'services', 'tasks', 'documents'] as const;
export type VehicleStore = (typeof VEHICLE_SCOPED)[number];
export type StoreName = 'vehicles' | VehicleStore | 'catalogOverlay' | 'suggestions' | 'meta';
export const ALL_STORES: StoreName[] = ['vehicles', ...VEHICLE_SCOPED, 'catalogOverlay', 'suggestions', 'meta'];

export type RideDB = IDBPDatabase<unknown>;

export function upgradeSchema(db: RideDB, oldVersion: number, _tx?: IDBPTransaction<unknown, string[], 'versionchange'>) {
  if (oldVersion < 1) {
    db.createObjectStore('vehicles', { keyPath: 'id' });
    for (const name of VEHICLE_SCOPED) {
      const s = db.createObjectStore(name, { keyPath: 'id' });
      s.createIndex('vehicleId', 'vehicleId');
    }
    db.createObjectStore('meta', { keyPath: 'key' });
  }
  if (oldVersion < 2) {
    db.createObjectStore('catalogOverlay', { keyPath: 'id' });
    db.createObjectStore('suggestions', { keyPath: 'id' });
  }
}

const opened = new Map<string, Promise<RideDB>>();

export function openRideDB(name = DB_NAME): Promise<RideDB> {
  let p = opened.get(name);
  if (!p) {
    p = openDB(name, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) { upgradeSchema(db as RideDB, oldVersion, tx as never); },
      blocked() { console.warn('RideRecord database upgrade is waiting for other tabs to close.'); },
      terminated() { opened.delete(name); },
    }) as Promise<RideDB>;
    p.catch(() => opened.delete(name));
    opened.set(name, p);
  }
  return p;
}

/** Close and forget a cached connection (tests, and before deleting a database). */
export async function closeRideDB(name = DB_NAME) {
  const p = opened.get(name);
  opened.delete(name);
  if (p) (await p).close();
}

/**
 * Run several writes as ONE transaction. If `fn` throws, the transaction is aborted and nothing is kept,
 * so a service record can never be saved without its companion changes (and vice versa).
 * `fn` must only await IndexedDB requests on the given transaction.
 */
export async function runAtomic<T>(db: RideDB, stores: StoreName[], fn: (tx: IDBPTransaction<unknown, StoreName[], 'readwrite'>) => Promise<T>): Promise<T> {
  const tx = db.transaction(stores, 'readwrite') as IDBPTransaction<unknown, StoreName[], 'readwrite'>;
  try {
    const result = await fn(tx);
    await tx.done;
    return result;
  } catch (err) {
    try { tx.abort(); } catch { /* already finished */ }
    try { await tx.done; } catch { /* abort rejects tx.done by design */ }
    throw err;
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* unsupported */ }
  return false;
}

/** Delete the whole local database (every vehicle, record, document and setting). Cannot be undone. */
export async function eraseEverything(name = DB_NAME): Promise<void> {
  await closeRideDB(name);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Could not erase local data.'));
    req.onblocked = () => reject(new Error('Another RideRecord tab is open. Close it and try again.'));
  });
}
