import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { DB_VERSION, closeRideDB, eraseEverything, openRideDB, runAtomic } from './db';
import {
  createVehicleWithTasks, listDeleted, listVehicleRecords, loadBundle, newId, putOverlay, restoreDeleted, restoreVehicle,
  save, saveService, softDelete, softDeleteVehicle,
} from './repo';
import { applyRestore, exportBackup, parseBackup, previewRestore, fromBase64, sha256Hex } from './backup';
import { computeDue } from '../domain/maintenance';
import { efficiencySegments } from '../domain/calc';
import { mergeCatalog } from '../domain/catalog';
import { SEED_CATALOG } from '../domain/catalogSeed';
import type { DocumentRec, FuelEntry, ServiceRecord, Vehicle } from '../domain/types';

let name = '';
let n = 0;
beforeEach(() => { name = `test-db-${++n}-${Math.random().toString(36).slice(2)}`; });
afterEach(async () => { await closeRideDB(name); indexedDB.deleteDatabase(name); });

const mkVehicle = (o: Partial<Vehicle> = {}): Vehicle => ({
  id: newId(), manufacturer: 'Royal Enfield', model: 'Hunter 350', year: 2024, category: 'naked', fuelType: 'petrol',
  drive: 'chain', cooling: 'air', isCustom: false, specSnapshot: {}, specOverrides: {}, sources: [], ownership: 'new',
  purchaseDate: '2024-03-01', initialOdometer: 10, createdAt: '', updatedAt: '', ...o,
});
const mkFuel = (vehicleId: string, o: Partial<FuelEntry> = {}): FuelEntry => ({
  id: newId(), vehicleId, kind: 'fuel', date: '2024-03-10', odometer: 100, quantity: 5, total: 500, fullTank: true, skippedPrevious: false, createdAt: '', updatedAt: '', ...o,
});

describe('persistence', () => {
  it('keeps data across a reload (close and reopen the database)', async () => {
    const db = await openRideDB(name);
    const { vehicle } = await createVehicleWithTasks(mkVehicle(), { odo: 10, date: '2024-03-01' }, false, db);
    await save('fuel', mkFuel(vehicle.id), db);
    await closeRideDB(name);
    const db2 = await openRideDB(name);
    const b = await loadBundle(vehicle.id, db2);
    expect(b?.fuel).toHaveLength(1);
    expect(b?.tasks.length).toBeGreaterThan(5);
    expect(b?.lastOdo?.km).toBe(100);
  });

  it('migrates v1 -> v2 without losing existing records', async () => {
    // build a genuine v1 database (no v2 stores) and put data in it
    const old = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('vehicles', { keyPath: 'id' });
        for (const s of ['odometer', 'fuel', 'expenses', 'services', 'tasks', 'documents']) db.createObjectStore(s, { keyPath: 'id' }).createIndex('vehicleId', 'vehicleId');
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    const veh = mkVehicle({ id: 'veh-old' });
    await old.put('vehicles', veh);
    await old.put('fuel', mkFuel('veh-old', { id: 'fuel-old' }));
    expect(old.objectStoreNames.contains('suggestions')).toBe(false);
    old.close();

    const db = await openRideDB(name); // triggers v2 upgrade
    expect(db.version).toBe(DB_VERSION);
    expect(db.objectStoreNames.contains('suggestions')).toBe(true);
    expect(db.objectStoreNames.contains('catalogOverlay')).toBe(true);
    expect((await db.get('vehicles', 'veh-old'))?.model).toBe('Hunter 350');
    expect(await db.get('fuel', 'fuel-old')).toBeTruthy();
  });

  it('rolls back a failed multi-record write (no partial data)', async () => {
    const db = await openRideDB(name);
    const v = mkVehicle();
    await expect(runAtomic(db, ['vehicles', 'fuel'], async tx => {
      await tx.objectStore('vehicles').put(v);
      await tx.objectStore('fuel').put(mkFuel(v.id));
      throw new Error('simulated failure mid-write');
    })).rejects.toThrow('simulated failure');
    expect(await db.getAll('vehicles')).toHaveLength(0);
    expect(await db.getAll('fuel')).toHaveLength(0);
  });

  it('creating a vehicle is atomic: a bad task write leaves no vehicle behind', async () => {
    const db = await openRideDB(name);
    const bad = mkVehicle();
    // A function value cannot be structured-cloned, so the put fails inside the transaction.
    (bad as unknown as Record<string, unknown>).specSnapshot = { poison: () => 1 };
    await expect(createVehicleWithTasks(bad, {}, false, db)).rejects.toBeTruthy();
    expect(await db.getAll('vehicles')).toHaveLength(0);
    expect(await db.getAll('tasks')).toHaveLength(0);
  });

  it('saving the same record twice (retry) does not duplicate it', async () => {
    const db = await openRideDB(name);
    const v = (await createVehicleWithTasks(mkVehicle(), {}, false, db)).vehicle;
    const entry = mkFuel(v.id);
    await save('fuel', entry, db);
    await save('fuel', entry, db);
    expect(await listVehicleRecords('fuel', v.id, {}, db)).toHaveLength(1);
  });

  it('keeps vehicles isolated from one another', async () => {
    const db = await openRideDB(name);
    const a = (await createVehicleWithTasks(mkVehicle(), {}, false, db)).vehicle;
    const b = (await createVehicleWithTasks(mkVehicle({ model: 'Activa 6G', category: 'scooter', drive: 'belt' }), {}, false, db)).vehicle;
    await save('fuel', mkFuel(a.id), db);
    expect((await loadBundle(b.id, db))?.fuel).toHaveLength(0);
    expect((await loadBundle(a.id, db))?.fuel).toHaveLength(1);
    expect((await loadBundle(b.id, db))?.tasks.some(t => t.key === 'belt-cvt')).toBe(true);
    expect((await loadBundle(b.id, db))?.tasks.some(t => t.key === 'chain-lube')).toBe(false);
  });
});

describe('maintenance completion', () => {
  it('creates a history record, keeps the old one, and moves the next-due point', async () => {
    const db = await openRideDB(name);
    const { vehicle, tasks } = await createVehicleWithTasks(mkVehicle(), { odo: 10, date: '2024-03-01' }, false, db);
    const oil = tasks.find(t => t.key === 'engine-oil')!;
    const mk = (date: string, odometer: number): ServiceRecord => ({ id: newId(), vehicleId: vehicle.id, date, odometer, work: 'Oil change', labourCost: 100, partsCost: 400, taskKeys: ['engine-oil'], createdAt: '', updatedAt: '' });
    await saveService(mk('2024-06-01', 3000), db);
    let b = await loadBundle(vehicle.id, db);
    expect(computeDue(oil, b!.services, 3200, '2024-06-02').dueOdo).toBe(6000);
    await saveService(mk('2024-09-01', 6100), db);
    b = await loadBundle(vehicle.id, db);
    expect(b!.services).toHaveLength(2);
    const due = computeDue(oil, b!.services, 6200, '2024-09-02');
    expect(due.dueOdo).toBe(9100);
    expect(due.lastDone?.odometer).toBe(6100);
    expect(due.status).toBe('ok');
  });
});

describe('catalog refresh never touches personal records', () => {
  it('vehicles keep their spec snapshot and records when the catalog overlay changes', async () => {
    const db = await openRideDB(name);
    const hunter = SEED_CATALOG.find(e => e.model === 'Hunter 350')!;
    const { vehicle } = await createVehicleWithTasks(mkVehicle({ catalogId: hunter.id, specSnapshot: hunter.specs }), {}, false, db);
    await save('fuel', mkFuel(vehicle.id), db);
    const before = JSON.stringify(await loadBundle(vehicle.id, db));
    await putOverlay([{ ...hunter, verification: 'verified', specs: { displacement: { value: 350, unit: 'cc', verification: 'verified' } }, sources: [{ kind: 'manufacturer', label: 'x' }] }], db);
    expect(mergeCatalog(await db.getAll('catalogOverlay')).find(e => e.id === hunter.id)?.specs.displacement?.value).toBe(350);
    expect(JSON.stringify(await loadBundle(vehicle.id, db))).toBe(before);
  });
});

describe('soft delete and recovery', () => {
  it('hides deleted records, lists them, and restores them', async () => {
    const db = await openRideDB(name);
    const { vehicle } = await createVehicleWithTasks(mkVehicle(), {}, false, db);
    const f = await save('fuel', mkFuel(vehicle.id), db);
    await softDelete('fuel', f.id, db);
    expect((await loadBundle(vehicle.id, db))?.fuel).toHaveLength(0);
    expect((await listDeleted(db)).map(r => r.id)).toContain(f.id);
    await restoreDeleted('fuel', f.id, db);
    expect((await loadBundle(vehicle.id, db))?.fuel).toHaveLength(1);
  });
  it('deleting a vehicle is recoverable together with its records, but not records deleted earlier', async () => {
    const db = await openRideDB(name);
    const { vehicle } = await createVehicleWithTasks(mkVehicle(), {}, false, db);
    const keep = await save('fuel', mkFuel(vehicle.id, { odometer: 200 }), db);
    const earlier = await save('fuel', mkFuel(vehicle.id, { odometer: 300 }), db);
    await softDelete('fuel', earlier.id, db);
    await softDeleteVehicle(vehicle.id, db);
    expect(await loadBundle(vehicle.id, db)).toBeUndefined();
    await restoreVehicle(vehicle.id, db);
    const b = await loadBundle(vehicle.id, db);
    expect(b?.fuel.map(x => x.id)).toEqual([keep.id]);
  });
});

describe('erase everything', () => {
  it('removes all data so the next open is a fresh database', async () => {
    const db = await openRideDB(name);
    await createVehicleWithTasks(mkVehicle(), {}, false, db);
    await eraseEverything(name);
    const fresh = await openRideDB(name);
    expect(await fresh.count('vehicles')).toBe(0);
    expect(await fresh.count('tasks')).toBe(0);
  });
});

describe('removing a vehicle with a reason', () => {
  it('stores the optional reason, shows it in the deleted list, and clears it on restore', async () => {
    const db = await openRideDB(name);
    const { vehicle } = await createVehicleWithTasks(mkVehicle(), {}, false, db);
    await softDeleteVehicle(vehicle.id, db, { reason: 'sold', rating: 4, note: 'Great commuter' });
    const row = (await listDeleted(db)).find(r => r.id === vehicle.id);
    expect(row?.removal).toMatchObject({ reason: 'sold', rating: 4, note: 'Great commuter' });
    await restoreVehicle(vehicle.id, db);
    expect((await loadBundle(vehicle.id, db))?.vehicle.removal).toBeUndefined();
  });
  it('stores nothing when every answer is skipped', async () => {
    const db = await openRideDB(name);
    const { vehicle } = await createVehicleWithTasks(mkVehicle(), {}, false, db);
    await softDeleteVehicle(vehicle.id, db, {});
    expect((await listDeleted(db)).find(r => r.id === vehicle.id)?.removal).toBeUndefined();
  });
});

describe('export and restore', () => {
  async function seed(db: Awaited<ReturnType<typeof openRideDB>>) {
    const { vehicle } = await createVehicleWithTasks(mkVehicle(), { odo: 10, date: '2024-03-01' }, false, db);
    await save('fuel', mkFuel(vehicle.id, { odometer: 100 }), db);
    await save('fuel', mkFuel(vehicle.id, { odometer: 300, quantity: 5, total: 550, date: '2024-03-20' }), db);
    const bytes = new Uint8Array([1, 2, 3, 250, 251]).buffer;
    const doc: DocumentRec = { id: newId(), vehicleId: vehicle.id, type: 'insurance', title: 'Policy', reminderDays: 30, fileName: 'p.pdf', mime: 'application/pdf', size: 5, data: bytes, createdAt: '', updatedAt: '' };
    await save('documents', doc, db);
    return { vehicle, doc };
  }

  it('round-trips through a backup file with a verified checksum, including document bytes', async () => {
    const db = await openRideDB(name);
    const { vehicle, doc } = await seed(db);
    const file = await exportBackup({}, db);
    const text = JSON.stringify(file);
    const parsed = await parseBackup(text);
    expect(parsed.ok).toBe(true);

    // restore into a fresh device
    const other = `${name}-other`;
    const db2 = await openRideDB(other);
    const pr = parsed.ok ? parsed.file : (undefined as never);
    const preview = await previewRestore(pr, 'add-only', db2);
    expect(preview.invalid).toHaveLength(0);
    expect(preview.stores.find(s => s.store === 'fuel')?.add).toBe(2);
    expect(preview.willWrite).toBeGreaterThan(5);
    // nothing is written until apply
    expect(await db2.getAll('fuel')).toHaveLength(0);
    await applyRestore(preview, db2);
    const b = await loadBundle(vehicle.id, db2);
    expect(b?.fuel).toHaveLength(2);
    expect(efficiencySegments(b!.fuel)[0].distance).toBe(200);
    const restoredDoc = (await db2.get('documents', doc.id)) as DocumentRec;
    expect([...new Uint8Array(restoredDoc.data)]).toEqual([1, 2, 3, 250, 251]);
    expect([...new Uint8Array(fromBase64('AQID+vs='))]).toEqual([1, 2, 3, 250, 251]);
    await closeRideDB(other); indexedDB.deleteDatabase(other);
  });

  it('rejects damaged, edited or foreign files before anything is imported', async () => {
    const db = await openRideDB(name);
    await seed(db);
    const file = await exportBackup({}, db);
    const tampered = JSON.parse(JSON.stringify(file));
    tampered.data.fuel[0].total = 1;
    const r1 = await parseBackup(JSON.stringify(tampered));
    expect(r1.ok).toBe(false);
    expect(!r1.ok && r1.error).toMatch(/integrity/);
    expect((await parseBackup('not json')).ok).toBe(false);
    expect((await parseBackup('{"hello":1}')).ok).toBe(false);
    expect((await parseBackup(JSON.stringify({ ...file, format: 99 }))).ok).toBe(false);
  });

  it('never silently replaces existing records: add-only skips them, newer-wins only overwrites older local copies', async () => {
    const db = await openRideDB(name);
    const { vehicle } = await seed(db);
    const file = await exportBackup({}, db);
    // change a local record after the backup => local is newer
    const fuel = (await listVehicleRecords<FuelEntry>('fuel', vehicle.id, {}, db))[0];
    await new Promise(r => setTimeout(r, 5));
    await save('fuel', { ...fuel, notes: 'edited after backup' }, db);
    const pAdd = await previewRestore(file, 'add-only', db);
    expect(pAdd.willWrite).toBe(0);
    expect(pAdd.stores.find(s => s.store === 'fuel')?.localNewer).toBe(1);
    const pNewer = await previewRestore(file, 'newer-wins', db);
    expect(pNewer.toWrite.some(w => w.store === 'fuel')).toBe(false); // local is newer, so it is kept
    // simulate an older local copy: rewrite the backup copy with a newer stamp
    const forged = JSON.parse(JSON.stringify(file));
    forged.data.fuel.find((f: { id: string }) => f.id === fuel.id).updatedAt = '2099-01-01T00:00:00.000Z';
    forged.data.fuel.find((f: { id: string }) => f.id === fuel.id).notes = 'from newer backup';
    const parsed = await parseBackup(JSON.stringify({ ...forged, checksum: await sha256Hex(JSON.stringify(forged.data)) }));
    expect(parsed.ok).toBe(true);
    const p3 = await previewRestore(parsed.ok ? parsed.file : (undefined as never), 'newer-wins', db);
    expect(p3.toWrite.filter(w => w.store === 'fuel')).toHaveLength(1);
    await applyRestore(p3, db);
    expect(((await db.get('fuel', fuel.id)) as FuelEntry).notes).toBe('from newer backup');
  });

  it('flags invalid records in the preview instead of importing them', async () => {
    const db = await openRideDB(name);
    const { vehicle } = await seed(db);
    const file = await exportBackup({}, db);
    const bad = JSON.parse(JSON.stringify(file));
    bad.data.fuel.push({ id: 'bad-1', vehicleId: vehicle.id, kind: 'fuel', date: 'nope', odometer: 1, quantity: 1, total: 1 });
    bad.data.fuel.push({ id: 'bad-2', vehicleId: 'ghost-vehicle', kind: 'fuel', date: '2024-01-01', odometer: 1, quantity: 1, total: 1 });
    bad.checksum = await sha256Hex(JSON.stringify(bad.data));
    const parsed = await parseBackup(JSON.stringify(bad));
    expect(parsed.ok).toBe(true);
    const p = await previewRestore(parsed.ok ? parsed.file : (undefined as never), 'add-only', db);
    expect(p.invalid.map(i => i.id).sort()).toEqual(['bad-1', 'bad-2']);
    expect(p.invalid.find(i => i.id === 'bad-2')?.reason).toMatch(/vehicle/);
  });

  it('a failed restore leaves existing data untouched', async () => {
    const db = await openRideDB(name);
    const { vehicle } = await seed(db);
    const file = await exportBackup({}, db);
    const other = `${name}-fail`;
    const db2 = await openRideDB(other);
    const preview = await previewRestore(file, 'add-only', db2);
    // poison one record so the transaction fails midway
    const poison: Record<string, unknown> = { id: 'poison', vehicleId: vehicle.id, date: '2024-01-01', odometer: 1, quantity: 1, total: 1, kind: 'fuel', fn: () => 1 };
    preview.toWrite.push({ store: 'fuel', record: poison });
    await expect(applyRestore(preview, db2)).rejects.toBeTruthy();
    expect(await db2.getAll('vehicles')).toHaveLength(0);
    expect(await db2.getAll('fuel')).toHaveLength(0);
    await closeRideDB(other); indexedDB.deleteDatabase(other);
  });
});
