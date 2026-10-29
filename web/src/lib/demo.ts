import { VEHICLE_SCOPED, openRideDB, runAtomic } from '../db/db';
import { createVehicleWithTasks, getMeta, newId, save, setMeta } from '../db/repo';
import { SEED_CATALOG } from '../domain/catalogSeed';
import { addDays, round, todayIso } from '../domain/calc';
import type { CatalogEntry, Expense, FuelEntry, ServiceRecord, Vehicle } from '../domain/types';

/**
 * Sample data for trying the app. Every figure below is INVENTED for demonstration (prices, distances, workshops)
 * and is removable in one click. It is never mixed into a real garage without the owner choosing to load it.
 */
const DEMO_KEY = 'demoVehicleIds';
export const getDemoIds = async () => (await getMeta<string[]>(DEMO_KEY)) ?? [];

// small deterministic generator so the demo looks the same every time
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

function vehicleFrom(entry: CatalogEntry, o: Partial<Vehicle>): Vehicle {
  const now = new Date().toISOString();
  return {
    id: newId(), manufacturer: entry.manufacturer, model: entry.model, year: entry.yearTo ?? new Date().getFullYear(), category: entry.category,
    fuelType: entry.fuelType, drive: entry.drive, cooling: entry.cooling, catalogId: entry.id, catalogUpdatedAt: entry.updatedAt, isCustom: false,
    specSnapshot: structuredClone(entry.specs), specOverrides: {}, sources: entry.sources, ownership: 'new', createdAt: now, updatedAt: now, ...o,
  };
}
const find = (model: string, gen?: string) => SEED_CATALOG.find(e => e.model === model && (!gen || e.generation === gen))!;

async function fills(v: Vehicle, o: { start: string; startOdo: number; count: number; gapDays: number; kmPerFill: number; qty: number; price: number; kind: 'fuel' | 'charge'; seed: number; station: string }) {
  const r = rng(o.seed);
  let odo = o.startOdo, date = o.start;
  for (let i = 0; i < o.count; i++) {
    const km = Math.round(o.kmPerFill * (0.9 + r() * 0.2));
    odo += i === 0 ? 0 : km;
    const eff = o.kmPerFill / o.qty;
    const qty = i === 0 ? o.qty : round(km / (eff * (0.93 + r() * 0.14)), 2);
    const price = round(o.price * (0.97 + r() * 0.06), 2);
    const e: FuelEntry = { id: newId(), vehicleId: v.id, kind: o.kind, date, odometer: odo, quantity: qty, pricePerUnit: price, total: round(qty * price), fullTank: true, skippedPrevious: false, station: o.station, payment: 'UPI', createdAt: '', updatedAt: '' };
    await save('fuel', e);
    date = addDays(date, o.gapDays + Math.round((r() - 0.5) * 4));
    if (date > todayIso()) break;
  }
}

export async function loadDemo(): Promise<number> {
  const existing = await getDemoIds();
  if (existing.length) return 0;
  const today = todayIso();
  const ids: string[] = [];

  // 1. Hunter 350: owned ~8 months, one service done
  const hunterEntry = find('Hunter 350');
  const hunter = vehicleFrom(hunterEntry, { year: 2025, variant: 'Retro Factory', ownership: 'new', purchaseDate: addDays(today, -245), purchasePrice: 165000, initialOdometer: 18, resaleEstimate: 125000, nickname: 'Daily Hunter' });
  await createVehicleWithTasks(hunter, { odo: 18, date: hunter.purchaseDate }, false);
  await fills(hunter, { start: addDays(today, -230), startOdo: 410, count: 12, gapDays: 18, kmPerFill: 330, qty: 7.4, price: 104, kind: 'fuel', seed: 7, station: 'Indian Oil, Salt Lake' });
  const hs: ServiceRecord = { id: newId(), vehicleId: hunter.id, date: addDays(today, -150), odometer: 2310, workshop: 'Sample Motors Service', work: 'First free service, engine oil and filter, chain adjust', parts: 'Engine oil 2 L, oil filter', labourCost: 0, partsCost: 1250, taskKeys: ['engine-oil', 'oil-filter', 'chain-adjust', 'general'], createdAt: '', updatedAt: '' };
  await save('services', hs);
  const hx: Expense[] = [
    { id: newId(), vehicleId: hunter.id, date: addDays(today, -240), category: 'insurance', amount: 11800, notes: 'Comprehensive 1 year', createdAt: '', updatedAt: '' },
    { id: newId(), vehicleId: hunter.id, date: addDays(today, -200), category: 'accessories', amount: 2400, notes: 'Crash guard', createdAt: '', updatedAt: '' },
    { id: newId(), vehicleId: hunter.id, date: addDays(today, -60), category: 'parking', amount: 600, notes: 'Monthly office parking', createdAt: '', updatedAt: '' },
  ];
  for (const x of hx) await save('expenses', x);
  ids.push(hunter.id);

  // 2. Activa 6G: used scooter, long-owned, service overdue to show the due states
  const activa = vehicleFrom(find('Activa 6G'), { year: 2021, variant: 'Standard', ownership: 'used', purchaseDate: addDays(today, -700), purchasePrice: 62000, initialOdometer: 9400, nickname: "Amma's Activa" });
  await createVehicleWithTasks(activa, { odo: 9400, date: addDays(today, -700) }, false);
  await fills(activa, { start: addDays(today, -300), startOdo: 14200, count: 10, gapDays: 30, kmPerFill: 190, qty: 3.1, price: 101, kind: 'fuel', seed: 21, station: 'HP Petrol Pump' });
  await save('services', { id: newId(), vehicleId: activa.id, date: addDays(today, -420), odometer: 12100, workshop: 'Local mechanic', work: 'General service and oil change', labourCost: 350, partsCost: 480, taskKeys: ['gear-oil', 'air-filter', 'general'], createdAt: '', updatedAt: '' } as ServiceRecord);
  ids.push(activa.id);

  // 3. Ather 450X: electric, charging log in kWh
  const ather = vehicleFrom(find('450X'), { year: 2024, ownership: 'new', purchaseDate: addDays(today, -160), purchasePrice: 155000, initialOdometer: 6, nickname: 'Office EV' });
  await createVehicleWithTasks(ather, { odo: 6, date: ather.purchaseDate }, false);
  await fills(ather, { start: addDays(today, -150), startOdo: 120, count: 14, gapDays: 10, kmPerFill: 105, qty: 2.6, price: 8.5, kind: 'charge', seed: 5, station: 'Home charger' });
  ids.push(ather.id);

  await setMeta(DEMO_KEY, ids);
  return ids.length;
}

export async function removeDemo(): Promise<number> {
  const ids = await getDemoIds();
  const db = await openRideDB();
  await runAtomic(db, ['vehicles', ...VEHICLE_SCOPED, 'suggestions'], async tx => {
    for (const id of ids) {
      await tx.objectStore('vehicles').delete(id);
      for (const name of VEHICLE_SCOPED) {
        const keys = await tx.objectStore(name).index('vehicleId').getAllKeys(id);
        for (const k of keys) await tx.objectStore(name).delete(k);
      }
    }
  });
  await setMeta(DEMO_KEY, []);
  return ids.length;
}
