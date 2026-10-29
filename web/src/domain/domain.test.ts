import { describe, expect, it } from 'vitest';
import {
  buildLedger, collectReadings, comparePeriods, costMetrics, efficiencySegments, findDuplicateExpense,
  fuelSummary, lastKnownOdometer, ownershipEstimate, spendByMonth, validateFuelEntry, validateOdometer,
} from './calc';
import { computeDue, applicableTemplates, expiryStatus, lastCompletion } from './maintenance';
import { searchCatalog, editDistance } from './search';
import { catalogCoverage, mergeCatalog, validateCatalogEntry } from './catalog';
import { SEED_CATALOG } from './catalogSeed';
import type { Expense, FuelEntry, MaintenanceTask, ServiceRecord } from './types';

const base = { vehicleId: 'v1', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const fuel = (id: string, date: string, odometer: number, quantity: number, total: number, fullTank = true, skippedPrevious = false): FuelEntry =>
  ({ ...base, id, kind: 'fuel', date, odometer, quantity, total, fullTank, skippedPrevious });
const svc = (id: string, date: string, odometer: number | undefined, taskKeys: string[], labourCost = 0, partsCost = 0): ServiceRecord =>
  ({ ...base, id, date, odometer, work: 'Service', labourCost, partsCost, taskKeys });
const task = (o: Partial<MaintenanceTask> = {}): MaintenanceTask => ({
  ...base, id: 't1', key: 'engine-oil', name: 'Engine oil', intervalKm: 3000, intervalMonths: 6, source: 'generic-default',
  baselineOdo: 10000, baselineDate: '2026-01-01', enabled: true, ...o,
});

describe('fuel efficiency (full-to-full)', () => {
  const entries = [
    fuel('a', '2026-01-01', 1000, 8, 800),
    fuel('b', '2026-01-10', 1150, 3, 300, false),
    fuel('c', '2026-01-20', 1300, 4, 400),
    fuel('d', '2026-02-01', 1500, 5, 500),
  ];
  it('adds partial top-ups into the segment and ignores the anchor fill', () => {
    const segs = efficiencySegments(entries);
    expect(segs).toHaveLength(2);
    expect(segs[0].distance).toBe(300);
    expect(segs[0].quantity).toBe(7);
    expect(segs[0].kmPerUnit).toBeCloseTo(42.857, 3);
    expect(segs[0].cost).toBe(700);
    expect(segs[0].costPerKm).toBeCloseTo(2.3333, 4);
    expect(segs[1].kmPerUnit).toBe(40);
  });
  it('summarises distance-weighted lifetime efficiency and cost per km', () => {
    const s = fuelSummary(entries);
    expect(s.lifetimeKmPerUnit).toBeCloseTo(500 / 12, 5);
    expect(s.costPerKm).toBeCloseTo(1200 / 500, 5);
    expect(s.avgPricePerUnit).toBeCloseTo(2000 / 20, 5);
    expect(s.latest?.toId).toBe('d');
  });
  it('does not calculate across a skipped fill', () => {
    const segs = efficiencySegments([...entries, fuel('e', '2026-03-01', 1900, 10, 1000, true, true)]);
    expect(segs).toHaveLength(2);
  });
  it('says why there is not enough data', () => {
    expect(fuelSummary([fuel('a', '2026-01-01', 1000, 8, 800)]).insufficientReason).toMatch(/at least two/);
    expect(fuelSummary([fuel('a', '2026-01-01', 1000, 8, 800), fuel('b', '2026-01-05', 1100, 3, 300, false)]).insufficientReason).toMatch(/consecutive/);
  });
  it('works for EV charging in kWh without petrol formulas', () => {
    const ev: FuelEntry[] = [
      { ...fuel('a', '2026-01-01', 500, 2, 20), kind: 'charge' },
      { ...fuel('b', '2026-01-15', 600, 2.5, 25), kind: 'charge' },
    ];
    const seg = efficiencySegments(ev)[0];
    expect(seg.unitPer100km).toBeCloseTo(2.5, 5); // kWh/100 km
    expect(seg.costPerKm).toBeCloseTo(0.25, 5);
  });
  it('compares the last 90 days with the 90 before', () => {
    const c = comparePeriods(entries, '2026-02-01', 90);
    expect(c.currentSpend).toBe(2000); // all four fills fall inside the 90 days ending 2026-02-01
    expect(c.previousSpend).toBe(0);
    const later = comparePeriods(entries, '2026-05-01', 90); // window 2026-01-31..05-01 holds only the Feb 1 fill
    expect(later.currentSpend).toBe(500);
    expect(later.previousSpend).toBe(1500);
    expect(later.spendChangePct).toBeCloseTo(((500 - 1500) / 1500) * 100, 5);
    expect(c.spendChangePct).toBeUndefined();
  });
  it('groups spend by month', () => {
    expect(spendByMonth(entries)).toEqual([{ month: '2026-01', spend: 1500 }, { month: '2026-02', spend: 500 }]);
  });
});

describe('validation', () => {
  const readings = collectReadings({ purchaseDate: '2026-01-01', initialOdometer: 100 }, [], [fuel('a', '2026-02-01', 1000, 5, 500)], [], []);
  it('blocks nonsense, warns (but allows) lower readings', () => {
    expect(validateOdometer(readings, { date: '2026-03-01', km: -5 }, undefined, '2026-03-10').errors[0]).toMatch(/negative/);
    expect(validateOdometer(readings, { date: '2026-03-01', km: NaN }, undefined, '2026-03-10').errors[0]).toMatch(/number/);
    expect(validateOdometer(readings, { date: '2026-12-01', km: 5000 }, undefined, '2026-03-10').errors[0]).toMatch(/future/);
    const lower = validateOdometer(readings, { date: '2026-03-01', km: 900 }, undefined, '2026-03-10');
    expect(lower.errors).toHaveLength(0);
    expect(lower.warnings[0]).toMatch(/lower than the 1,000 km/);
  });
  it('warns when a reading sits above a later reading and on implausible daily distance', () => {
    expect(validateOdometer(readings, { date: '2026-01-15', km: 2000 }, undefined, '2026-03-10').warnings.some(w => /already recorded later/.test(w))).toBe(true);
    expect(validateOdometer(readings, { date: '2026-02-02', km: 5000 }, undefined, '2026-03-10').warnings.some(w => /per day/.test(w))).toBe(true);
  });
  it('accepts a valid reading cleanly and finds the last known reading', () => {
    expect(validateOdometer(readings, { date: '2026-03-01', km: 1500 }, undefined, '2026-03-10')).toEqual({ errors: [], warnings: [] });
    expect(lastKnownOdometer(readings)?.km).toBe(1000);
  });
  it('flags fuel entries whose maths or capacity looks wrong, without blocking', () => {
    const v = validateFuelEntry({ kind: 'fuel', quantity: 10, pricePerUnit: 100, total: 700 }, 12);
    expect(v.errors).toHaveLength(0);
    expect(v.warnings[0]).toMatch(/= 1000/);
    expect(validateFuelEntry({ kind: 'fuel', quantity: 20, total: 2000 }, 12).warnings[0]).toMatch(/capacity/);
    expect(validateFuelEntry({ kind: 'fuel', quantity: 0, total: 5 }).errors[0]).toMatch(/litres/);
  });
});

describe('ledger and cost metrics', () => {
  const fl = [fuel('a', '2026-01-01', 1000, 8, 800), fuel('c', '2026-01-20', 1300, 4, 400)];
  const sv = [svc('s1', '2026-01-25', 1320, ['engine-oil'], 200, 300)];
  const ex: Expense[] = [
    { ...base, id: 'x1', date: '2026-01-30', category: 'insurance', amount: 5000 },
    { ...base, id: 'x2', date: '2026-01-31', category: 'tyres', amount: 2000, odometer: 1400 },
  ];
  const ledger = buildLedger(fl, sv, ex);
  const readings = collectReadings({ purchaseDate: '2026-01-01', initialOdometer: 1000 }, [], fl, sv, ex);
  it('counts every recorded rupee exactly once', () => {
    expect(ledger).toHaveLength(5);
    expect(ledger.reduce((a, i) => a + i.amount, 0)).toBe(800 + 400 + 500 + 5000 + 2000);
  });
  it('computes the distinct metrics with transparent definitions', () => {
    const m = costMetrics(ledger, fl, readings, { from: '2026-01-01', to: '2026-01-31' });
    expect(m.totalRecordedCash).toBe(8700);
    expect(m.maintenanceAndRepair).toBe(2500); // service 500 + tyres 2000
    expect(m.fuelCostPerKm).toBeCloseTo(400 / 300, 5);
    expect(m.kmInPeriod).toBe(400);
    // operating categories default to fuel/charging/service/repair/tyres/consumables => insurance excluded
    expect(m.operatingCostPerKm).toBeCloseTo((800 + 400 + 500 + 2000) / 400, 5);
  });
  it('lets the rider choose categories', () => {
    const m = costMetrics(ledger, fl, readings, { from: '2026-01-01', to: '2026-01-31', operatingCategories: ['fuel', 'insurance'] });
    expect(m.operatingCostPerKm).toBeCloseTo((800 + 400 + 5000) / 400, 5);
  });
  it('reports insufficient data instead of inventing numbers', () => {
    const m = costMetrics(buildLedger([], [], []), [], [], {});
    expect(m.fuelCostPerKm).toBeUndefined();
    expect(m.operatingCostPerKm).toBeUndefined();
    expect(m.notes).toHaveLength(2);
  });
  it('keeps depreciation an explicit assumption and never counts the purchase price as cash', () => {
    const est = ownershipEstimate({ purchaseDate: '2026-01-01', purchasePrice: 100000, resaleEstimate: 80000 }, ledger, ['fuel', 'service'], '2026-07-02');
    expect(est?.cash).toBe(1700);
    expect(est?.depreciation).toBe(20000);
    expect(est?.total).toBe(21700);
    expect(est?.assumptions.join(' ')).toMatch(/your assumption/);
    expect(ownershipEstimate({ purchaseDate: '2026-01-01' }, ledger, ['fuel'], '2026-07-02')?.depreciation).toBeUndefined();
  });
  it('detects probable duplicate expenses but only as a warning', () => {
    expect(findDuplicateExpense(ex, { date: '2026-01-31', amount: 5000, category: 'insurance' })?.id).toBe('x1');
    expect(findDuplicateExpense(ex, { date: '2026-03-01', amount: 5000, category: 'insurance' })).toBeUndefined();
  });
});

describe('maintenance engine', () => {
  const t = task();
  it('is ok, soon, due and overdue on the km rule', () => {
    expect(computeDue(t, [], 11000, '2026-02-01').status).toBe('ok');
    expect(computeDue(t, [], 11000, '2026-02-01').kmRemaining).toBe(2000);
    expect(computeDue(t, [], 12800, '2026-02-01').status).toBe('soon');
    expect(computeDue(t, [], 13000, '2026-02-01').status).toBe('due');
    expect(computeDue(t, [], 13700, '2026-02-01').status).toBe('overdue');
  });
  it('is due when EITHER threshold is reached', () => {
    const byTime = computeDue(t, [], 10100, '2026-07-01');
    expect(byTime.status).toBe('due');
    expect(byTime.trigger).toBe('time');
    expect(byTime.dueDate).toBe('2026-07-01');
  });
  it('uses the latest completion as the new starting point and leaves old events intact', () => {
    const services = [svc('s1', '2026-03-01', 11500, ['engine-oil']), svc('s2', '2026-07-02', 13000, ['engine-oil'])];
    const due = computeDue(t, services, 13500, '2026-07-10');
    expect(due.basis).toBe('last-service');
    expect(due.dueOdo).toBe(16000);
    expect(due.status).toBe('ok');
    expect(services).toHaveLength(2);
    expect(lastCompletion(t, services)?.id).toBe('s2');
  });
  it('handles missing data honestly', () => {
    expect(computeDue(task({ baselineOdo: undefined, baselineDate: undefined }), [], 5000, '2026-02-01').status).toBe('unknown');
    const noOdo = computeDue(t, [], undefined, '2026-02-01');
    expect(noOdo.status).toBe('ok');
    expect(noOdo.message).toMatch(/add an odometer reading/);
    expect(computeDue(task({ intervalKm: undefined, intervalMonths: undefined }), [], 1, '2026-02-01').status).toBe('unknown');
  });
  it('ignores soft-deleted service records', () => {
    const s = { ...svc('s1', '2026-03-01', 11500, ['engine-oil']), deletedAt: '2026-03-02' };
    expect(lastCompletion(t, [s])).toBeUndefined();
  });
  it('applies the right tasks to each drivetrain', () => {
    const keys = (v: Parameters<typeof applicableTemplates>[0]) => applicableTemplates(v).map(x => x.key);
    const ev = keys({ fuelType: 'electric', drive: 'electric', cooling: 'unknown', category: 'electric-scooter' });
    expect(ev).toContain('ev-battery');
    expect(ev).not.toContain('engine-oil');
    expect(ev).not.toContain('chain-lube');
    const scooter = keys({ fuelType: 'petrol', drive: 'belt', cooling: 'air', category: 'scooter' });
    expect(scooter).toContain('belt-cvt');
    expect(scooter).not.toContain('chain-lube');
    const shaft = keys({ fuelType: 'petrol', drive: 'shaft', cooling: 'liquid', category: 'adventure' });
    expect(shaft).toContain('final-drive-oil');
    expect(shaft).toContain('coolant');
    const chainAir = keys({ fuelType: 'petrol', drive: 'chain', cooling: 'air', category: 'commuter' });
    expect(chainAir).toContain('chain-lube');
    expect(chainAir).not.toContain('coolant');
  });
  it('classifies document expiry', () => {
    expect(expiryStatus('2026-01-01', 30, '2026-02-01')).toBe('expired');
    expect(expiryStatus('2026-02-20', 30, '2026-02-01')).toBe('soon');
    expect(expiryStatus('2026-09-20', 30, '2026-02-01')).toBe('ok');
    expect(expiryStatus(undefined, 30)).toBe('none');
  });
});

describe('catalog search and identification', () => {
  const cat = SEED_CATALOG;
  const top = (q: string, f = {}) => searchCatalog(cat, q, f);
  it('finds a known model by natural phrase and does not need confirmation', () => {
    const r = top('Royal Enfield Hunter 350 2025.');
    expect(r.hits[0].entry.model).toBe('Hunter 350');
    expect(r.parsed.year).toBe(2025);
    expect(r.needsConfirmation).toBe(false);
  });
  it('separates generations by name and year', () => {
    const r = top('Yamaha R15 V4 2023');
    expect(r.hits[0].entry.id).toContain('r15-v4');
    expect(r.hits.every(h => !h.entry.id.includes('r15-v3'))).toBe(true);
    expect(r.needsConfirmation).toBe(false);
  });
  it('finds scooters through typos, alternate spellings and partial names', () => {
    expect(top('Acitva 6g').hits[0].entry.model).toBe('Activa 6G');
    expect(top('honda activa6g').hits[0].entry.model).toBe('Activa 6G');
    expect(top('suzuki acces').hits[0].entry.model).toBe('Access 125');
    expect(top('tvs skooter').hits.some(h => h.entry.model === 'Jupiter')).toBe(true);
    expect(top('splender').hits[0].entry.model).toBe('Splendor Plus');
    expect(top('re himalayan').hits[0].entry.manufacturer).toBe('Royal Enfield');
  });
  it('handles category intent words', () => {
    const r = top('TVS electric scooter');
    expect(r.hits[0].entry.model).toBe('iQube');
  });
  it('asks for confirmation when several generations plausibly match', () => {
    const r = top('KTM Duke 390 old model');
    expect(r.needsConfirmation).toBe(true);
    expect(r.explanation).toMatch(/generations/);
    expect(r.hits.filter(h => h.entry.model === 'Duke 390').length).toBe(3);
    const withYear = top('KTM Duke 390 2019');
    expect(withYear.hits[0].entry.generation).toMatch(/Gen 2/);
    expect(withYear.needsConfirmation).toBe(false);
  });
  it('treats numeric tokens strictly (350 is not 450)', () => {
    const r = top('Himalayan 450');
    expect(r.hits[0].entry.model).toBe('Himalayan 450');
  });
  it('supports manufacturer-first browsing and filters', () => {
    const r = searchCatalog(cat, '', { manufacturer: 'Bajaj' });
    expect(r.hits.length).toBeGreaterThan(3);
    expect(r.hits.every(h => h.entry.manufacturer === 'Bajaj')).toBe(true);
    expect(searchCatalog(cat, '', { fuelType: 'electric' }).hits.every(h => h.entry.fuelType === 'electric')).toBe(true);
    expect(searchCatalog(cat, 'classic 350', { year: 2015 }).hits[0].entry.generation).toMatch(/UCE/);
  });
  it('returns an honest empty result for unknown vehicles', () => {
    const r = top('Zundapp Falconetta 1962');
    expect(r.hits).toHaveLength(0);
    expect(r.explanation).toMatch(/custom profile/);
  });
  it('edit distance counts transpositions as one edit', () => {
    expect(editDistance('activa', 'acitva')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('catalog integrity and external data', () => {
  it('seed records carry no unverified performance figures and are never marked verified', () => {
    for (const e of SEED_CATALOG) {
      expect(e.verification).toBe('seed-unverified');
      expect(Object.keys(e.specs).every(k => k === 'displacement')).toBe(true);
    }
    const ids = SEED_CATALOG.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('validates and sanitises imported records', () => {
    const ok = validateCatalogEntry({
      manufacturer: ' Royal   Enfield ', model: 'Hunter 350\u0000', yearFrom: 2022, yearTo: null, category: 'naked', fuelType: 'petrol',
      verification: 'verified', sources: [{ kind: 'manufacturer', label: 'Brochure', url: 'javascript:alert(1)' }],
      specs: { power: { value: 20.2, unit: 'bhp' }, bogus: { value: 1 } },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.entry.manufacturer).toBe('Royal Enfield');
      expect(ok.entry.model).toBe('Hunter 350');
      expect(ok.entry.sources[0].url).toBeUndefined(); // unsafe protocol dropped
      expect(ok.entry.specs.power?.value).toBe(20.2);
      expect((ok.entry.specs as Record<string, unknown>).bogus).toBeUndefined();
      expect(ok.entry.verification).toBe('verified');
    }
    const bad = validateCatalogEntry({ manufacturer: 'X', yearFrom: 1800, category: 'nope', fuelType: 'petrol' });
    expect(bad.ok).toBe(false);
  });
  it('refuses to keep "verified" without an official source', () => {
    const r = validateCatalogEntry({ manufacturer: 'A', model: 'B', yearFrom: 2020, yearTo: null, category: 'naked', fuelType: 'petrol', verification: 'verified', sources: [{ kind: 'third-party', label: 'blog' }] });
    expect(r.ok && r.entry.verification).toBe('estimated');
  });
  it('overlay records override seed records by id and coverage is measured, not claimed', () => {
    const hunter = SEED_CATALOG.find(e => e.model === 'Hunter 350')!;
    const merged = mergeCatalog([{ ...hunter, verification: 'verified', sources: [{ kind: 'manufacturer', label: 'x' }] }]);
    expect(merged).toHaveLength(SEED_CATALOG.length);
    const cov = catalogCoverage(merged);
    expect(cov.byVerification.verified).toBe(1);
    expect(cov.total).toBe(SEED_CATALOG.length);
  });
});

import { effectiveRatePct, emiFlat, emiReducing, instalmentsDue, onRoadTotal, plan, schedule } from './loan';
describe('loan maths', () => {
  it('computes the standard reducing-balance EMI', () => {
    expect(emiReducing(100000, 12, 12)).toBeCloseTo(8884.88, 1);
    expect(emiReducing(120000, 0, 12)).toBe(10000);
    expect(emiReducing(0, 10, 12)).toBe(0);
  });
  it('flat rate costs more than the same reducing rate, and its effective rate is higher', () => {
    const flat = emiFlat(100000, 8, 36), red = emiReducing(100000, 8, 36);
    expect(flat).toBeGreaterThan(red);
    expect(effectiveRatePct(100000, flat, 36)).toBeGreaterThan(13);
    expect(effectiveRatePct(100000, red, 36)).toBeCloseTo(8, 3);
  });
  it('builds a schedule that repays the principal exactly', () => {
    for (const method of ['reducing', 'flat'] as const) {
      const rows = schedule(method, 80000, 10, 24);
      expect(rows).toHaveLength(24);
      expect(rows.reduce((a, r) => a + r.principal, 0)).toBeCloseTo(80000, 4);
      expect(rows[23].balance).toBe(0);
    }
  });
  it('sums the on-road price and builds a plan', () => {
    const o = onRoadTotal({ exShowroom: 150000, roadTax: 15000, insurance: 12000, handling: 3000, accessories: 5000, discount: 5000 });
    expect(o).toBe(180000);
    const p = plan({ onRoad: o, downPayment: 30000, ratePct: 10, months: 36, method: 'reducing', processingFee: 1000 });
    expect(p.financed).toBe(150000);
    expect(p.totalOutlay).toBeCloseTo(30000 + p.emi * 36 + 1000, 6);
    expect(plan({ onRoad: 100, downPayment: 500, ratePct: 10, months: 12, method: 'reducing', processingFee: 0 }).financed).toBe(0);
  });
  it('counts instalments due by date', () => {
    expect(instalmentsDue('2026-11-05', '2026-10-20', 12)).toBe(0);
    expect(instalmentsDue('2026-11-05', '2026-11-05', 12)).toBe(1);
    expect(instalmentsDue('2026-11-05', '2027-01-04', 12)).toBe(2);
    expect(instalmentsDue('2026-11-05', '2030-01-01', 12)).toBe(12);
  });
});
