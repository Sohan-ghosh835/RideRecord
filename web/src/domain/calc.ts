import type {
  Expense, ExpenseCategory, FuelEntry, OdometerReading, ServiceRecord, Vehicle,
} from './types';

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const todayIso = () => isoDay(new Date());
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export const addMonths = (iso: string, months: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0); // 31 Jan + 1 month => 28/29 Feb
  return isoDay(d);
};
export const addDays = (iso: string, days: number) => isoDay(new Date(Date.parse(iso) + days * 86_400_000));

// ---------- Odometer ----------

export interface Reading { date: string; km: number; source: 'purchase' | 'manual' | 'fuel' | 'service' | 'expense'; sourceId?: string }

/** All odometer readings for a vehicle, derived from every record that carries one. */
export function collectReadings(
  v: Pick<Vehicle, 'purchaseDate' | 'initialOdometer'>,
  manual: OdometerReading[], fuel: FuelEntry[], services: ServiceRecord[], expenses: Expense[],
): Reading[] {
  const out: Reading[] = [];
  if (v.initialOdometer !== undefined && v.purchaseDate) out.push({ date: v.purchaseDate, km: v.initialOdometer, source: 'purchase' });
  for (const r of manual) out.push({ date: r.date, km: r.km, source: 'manual', sourceId: r.id });
  for (const f of fuel) out.push({ date: f.date, km: f.odometer, source: 'fuel', sourceId: f.id });
  for (const s of services) if (s.odometer !== undefined) out.push({ date: s.date, km: s.odometer, source: 'service', sourceId: s.id });
  for (const x of expenses) if (x.odometer !== undefined) out.push({ date: x.date, km: x.odometer, source: 'expense', sourceId: x.id });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
}

export const lastKnownOdometer = (readings: Reading[]): Reading | undefined =>
  readings.length ? readings.reduce((a, b) => (b.km > a.km ? b : a)) : undefined;

export interface Validation { errors: string[]; warnings: string[] }

/**
 * Hard errors block saving (nonsense input). Warnings can be acknowledged and overridden,
 * so a genuine correction (odometer replaced, earlier typo) is never impossible.
 */
export function validateOdometer(readings: Reading[], input: { date: string; km: number }, ignoreSourceId?: string, today = todayIso()): Validation {
  const errors: string[] = [], warnings: string[] = [];
  if (!Number.isFinite(input.km)) errors.push('Enter the odometer reading as a number.');
  else if (input.km < 0) errors.push('Odometer cannot be negative.');
  else if (input.km > 1_500_000) errors.push('That reading is higher than any realistic two-wheeler odometer. Check for an extra digit.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) errors.push('Enter a valid date.');
  else if (input.date > addDays(today, 1)) errors.push('The date is in the future.');
  if (errors.length) return { errors, warnings };

  const others = readings.filter(r => !(ignoreSourceId && r.sourceId === ignoreSourceId));
  const before = [...others].filter(r => r.date <= input.date).sort((a, b) => b.date.localeCompare(a.date) || b.km - a.km)[0];
  const after = [...others].filter(r => r.date > input.date).sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km)[0];
  if (before && input.km < before.km) {
    warnings.push(`${input.km.toLocaleString('en-IN')} km is lower than the ${before.km.toLocaleString('en-IN')} km recorded on ${before.date}. If the odometer was replaced or reset, confirm to save; otherwise correct the number.`);
  }
  if (after && input.km > after.km) {
    warnings.push(`${input.km.toLocaleString('en-IN')} km is higher than the ${after.km.toLocaleString('en-IN')} km already recorded later, on ${after.date}.`);
  }
  if (before && input.km >= before.km) {
    const days = Math.max(1, daysBetween(before.date, input.date));
    const perDay = (input.km - before.km) / days;
    if (perDay > 1000) warnings.push(`That is ${Math.round(perDay).toLocaleString('en-IN')} km per day since ${before.date}, which is unusually high. Check the reading.`);
  }
  return { errors, warnings };
}

// ---------- Fuel / charging efficiency ----------

export interface Segment {
  fromId: string; toId: string;
  fromDate: string; toDate: string;
  fromOdo: number; toOdo: number;
  distance: number;
  quantity: number; // litres or kWh consumed over the segment
  cost: number;
  /** distance / quantity (km/L or km/kWh) */
  kmPerUnit: number;
  /** quantity per 100 km (L/100km or kWh/100km) */
  unitPer100km: number;
  costPerKm: number;
}

const byOdo = (a: FuelEntry, b: FuelEntry) => a.odometer - b.odometer || a.date.localeCompare(b.date);

/**
 * Full-tank-to-full-tank method. A segment runs between two consecutive full fills.
 * Fuel counted is everything put in AFTER the earlier full fill up to and including the later one
 * (partial top-ups in between are added in). Segments spanning a skipped fill are not calculable.
 */
export function efficiencySegments(entries: FuelEntry[]): Segment[] {
  const sorted = [...entries].sort(byOdo);
  const segs: Segment[] = [];
  let anchor: FuelEntry | undefined;
  let qty = 0, cost = 0, broken = false;
  for (const e of sorted) {
    if (anchor) {
      qty += e.quantity; cost += e.total;
      if (e.skippedPrevious) broken = true;
    }
    if (e.fullTank) {
      if (anchor && !broken) {
        const distance = e.odometer - anchor.odometer;
        if (distance > 0 && qty > 0) {
          segs.push({
            fromId: anchor.id, toId: e.id, fromDate: anchor.date, toDate: e.date,
            fromOdo: anchor.odometer, toOdo: e.odometer, distance, quantity: qty, cost,
            kmPerUnit: distance / qty, unitPer100km: (qty / distance) * 100, costPerKm: cost / distance,
          });
        }
      }
      anchor = e; qty = 0; cost = 0; broken = false;
    }
  }
  return segs;
}

export interface FuelSummary {
  segments: Segment[];
  latest?: Segment;
  recentAvgKmPerUnit?: number; // last 3 segments, distance-weighted
  lifetimeKmPerUnit?: number;  // all segments, distance-weighted
  costPerKm?: number;          // valid segments only
  avgPricePerUnit?: number;    // total paid / total quantity across all entries with data
  totalSpend: number;
  totalQuantity: number;
  entryCount: number;
  insufficientReason?: string;
}

const weighted = (segs: Segment[]) => {
  const d = segs.reduce((a, s) => a + s.distance, 0);
  const q = segs.reduce((a, s) => a + s.quantity, 0);
  return q > 0 ? d / q : undefined;
};

export function fuelSummary(entries: FuelEntry[]): FuelSummary {
  const segments = efficiencySegments(entries);
  const totalSpend = entries.reduce((a, e) => a + e.total, 0);
  const totalQuantity = entries.reduce((a, e) => a + e.quantity, 0);
  const dist = segments.reduce((a, s) => a + s.distance, 0);
  const cost = segments.reduce((a, s) => a + s.cost, 0);
  let insufficientReason: string | undefined;
  if (entries.length < 2) insufficientReason = 'Log at least two full-tank fills to calculate real-world efficiency.';
  else if (!segments.length) insufficientReason = 'No pair of consecutive full-tank fills yet. Fill to full each time (or mark partial fills correctly) so efficiency can be measured.';
  return {
    segments, latest: segments[segments.length - 1],
    recentAvgKmPerUnit: segments.length ? weighted(segments.slice(-3)) : undefined,
    lifetimeKmPerUnit: segments.length ? weighted(segments) : undefined,
    costPerKm: dist > 0 ? cost / dist : undefined,
    avgPricePerUnit: totalQuantity > 0 ? totalSpend / totalQuantity : undefined,
    totalSpend, totalQuantity, entryCount: entries.length, insufficientReason,
  };
}

export interface FuelValidation extends Validation { derivedTotal?: number }

/** Quantity x price should roughly equal total; flag when it does not, never block. */
export function validateFuelEntry(input: { quantity: number; pricePerUnit?: number; total: number; kind: 'fuel' | 'charge' }, tankOrBatteryCapacity?: number): FuelValidation {
  const errors: string[] = [], warnings: string[] = [];
  const unit = input.kind === 'fuel' ? 'litres' : 'kWh';
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) errors.push(`Enter the ${unit} added (more than 0).`);
  if (!Number.isFinite(input.total) || input.total < 0) errors.push('Enter the total paid (0 or more).');
  if (errors.length) return { errors, warnings };
  if (tankOrBatteryCapacity && input.quantity > tankOrBatteryCapacity * 1.15) {
    warnings.push(`${input.quantity} ${unit} is more than the ${tankOrBatteryCapacity} ${unit} capacity listed for this vehicle. Check the quantity or the capacity.`);
  }
  let derivedTotal: number | undefined;
  if (input.pricePerUnit && input.pricePerUnit > 0) {
    derivedTotal = round(input.quantity * input.pricePerUnit);
    if (Math.abs(derivedTotal - input.total) > Math.max(2, input.total * 0.03)) {
      warnings.push(`${input.quantity} x ${input.pricePerUnit} = ${derivedTotal}, but the total entered is ${input.total}.`);
    }
  }
  return { errors, warnings, derivedTotal };
}

export interface PeriodCompare {
  currentSpend: number; previousSpend: number; spendChangePct?: number;
  currentKmPerUnit?: number; previousKmPerUnit?: number; efficiencyChangePct?: number;
}

/** Compare the last `days` days with the `days` before that, based on the day `end`. */
export function comparePeriods(entries: FuelEntry[], end: string, days = 90): PeriodCompare {
  const curStart = addDays(end, -days), prevStart = addDays(end, -2 * days);
  const inRange = (e: FuelEntry, a: string, b: string) => e.date > a && e.date <= b;
  const cur = entries.filter(e => inRange(e, curStart, end));
  const prev = entries.filter(e => inRange(e, prevStart, curStart));
  const sum = (xs: FuelEntry[]) => xs.reduce((a, e) => a + e.total, 0);
  const segs = efficiencySegments(entries);
  const eff = (a: string, b: string) => weighted(segs.filter(s => s.toDate > a && s.toDate <= b));
  const cs = sum(cur), ps = sum(prev), ce = eff(curStart, end), pe = eff(prevStart, curStart);
  return {
    currentSpend: cs, previousSpend: ps, spendChangePct: ps > 0 ? ((cs - ps) / ps) * 100 : undefined,
    currentKmPerUnit: ce, previousKmPerUnit: pe, efficiencyChangePct: ce && pe ? ((ce - pe) / pe) * 100 : undefined,
  };
}

export function spendByMonth(entries: { date: string; total: number }[]): { month: string; spend: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.date.slice(0, 7), (m.get(e.date.slice(0, 7)) ?? 0) + e.total);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, spend]) => ({ month, spend: round(spend) }));
}
export function spendByYear(entries: { date: string; total: number }[]) {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.date.slice(0, 4), (m.get(e.date.slice(0, 4)) ?? 0) + e.total);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, spend]) => ({ year, spend: round(spend) }));
}

// ---------- Unified expense ledger & cost metrics ----------

export type LedgerCategory = ExpenseCategory | 'fuel' | 'charging' | 'service';
export interface LedgerItem {
  id: string; source: 'fuel' | 'service' | 'expense'; date: string; category: LedgerCategory; amount: number; odometer?: number; label: string;
}

/**
 * Build one ledger from the three places money is recorded. Each rupee appears exactly once:
 * fuel/charging only from fuel entries, workshop bills only from service records, everything else from expenses.
 * (The expense form refuses 'fuel' and 'service' categories for that reason.)
 */
export function buildLedger(fuel: FuelEntry[], services: ServiceRecord[], expenses: Expense[]): LedgerItem[] {
  const items: LedgerItem[] = [];
  for (const f of fuel) items.push({ id: f.id, source: 'fuel', date: f.date, category: f.kind === 'fuel' ? 'fuel' : 'charging', amount: f.total, odometer: f.odometer, label: f.station || (f.kind === 'fuel' ? 'Fuel' : 'Charging') });
  for (const s of services) items.push({ id: s.id, source: 'service', date: s.date, category: 'service', amount: s.labourCost + s.partsCost, odometer: s.odometer, label: s.workshop || s.work.slice(0, 40) });
  for (const x of expenses) items.push({ id: x.id, source: 'expense', date: x.date, category: x.category, amount: x.amount, odometer: x.odometer, label: x.notes?.slice(0, 40) || x.category });
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

export interface PeriodSpec { from?: string; to?: string; categories?: LedgerCategory[] }

export const filterLedger = (items: LedgerItem[], p: PeriodSpec) =>
  items.filter(i => (!p.from || i.date >= p.from) && (!p.to || i.date <= p.to) && (!p.categories || p.categories.includes(i.category)));

export const MAINTENANCE_CATEGORIES: LedgerCategory[] = ['service', 'repair', 'tyres', 'consumables'];

export interface CostMetrics {
  period: { from?: string; to?: string };
  totalRecordedCash: number;
  maintenanceAndRepair: number;
  fuelCostPerKm?: number;
  operatingCostPerKm?: number;
  kmInPeriod?: number;
  operatingCategories: LedgerCategory[];
  notes: string[];
}

/**
 * - totalRecordedCash: everything recorded in the period (all categories, no allocation).
 * - fuelCostPerKm: fuel/charging spend / distance, only for full-to-full segments finishing in the period.
 * - operatingCostPerKm: chosen categories' spend / distance between the first and last odometer readings in the period.
 * Loan interest is only the interest portion the owner recorded; EMI principal is never counted.
 */
export function costMetrics(ledger: LedgerItem[], fuel: FuelEntry[], readings: Reading[], period: PeriodSpec & { operatingCategories?: LedgerCategory[] }): CostMetrics {
  const inPeriod = filterLedger(ledger, { from: period.from, to: period.to });
  const opCats = period.operatingCategories ?? ['fuel', 'charging', 'service', 'repair', 'tyres', 'consumables'];
  const notes: string[] = [];
  const total = inPeriod.reduce((a, i) => a + i.amount, 0);
  const maint = inPeriod.filter(i => MAINTENANCE_CATEGORIES.includes(i.category)).reduce((a, i) => a + i.amount, 0);

  const segs = efficiencySegments(fuel).filter(s => (!period.from || s.toDate >= period.from) && (!period.to || s.toDate <= period.to));
  const segDist = segs.reduce((a, s) => a + s.distance, 0);
  const fuelCostPerKm = segDist > 0 ? segs.reduce((a, s) => a + s.cost, 0) / segDist : undefined;
  if (fuelCostPerKm === undefined) notes.push('Fuel cost per km needs at least two consecutive full-tank fills in the period.');

  const rs = readings.filter(r => (!period.from || r.date >= period.from) && (!period.to || r.date <= period.to));
  let kmInPeriod: number | undefined;
  if (rs.length >= 2) {
    const kms = rs.map(r => r.km);
    const d = Math.max(...kms) - Math.min(...kms);
    if (d > 0) kmInPeriod = d;
  }
  let operatingCostPerKm: number | undefined;
  if (kmInPeriod) {
    const spend = inPeriod.filter(i => opCats.includes(i.category)).reduce((a, i) => a + i.amount, 0);
    operatingCostPerKm = spend / kmInPeriod;
  } else notes.push('Operating cost per km needs two odometer readings in the period.');
  return { period: { from: period.from, to: period.to }, totalRecordedCash: total, maintenanceAndRepair: maint, fuelCostPerKm, operatingCostPerKm, kmInPeriod, operatingCategories: opCats, notes };
}

export interface OwnershipEstimate {
  months: number;
  cash: number;
  depreciation?: number;
  total: number;
  perMonth: number;
  assumptions: string[];
}

/**
 * Optional broader estimate. Depreciation = purchase price - owner's own resale estimate (an assumption, labelled as such),
 * spread across the ownership months alongside the recorded cash costs. The purchase price itself is NOT also counted as cash.
 */
export function ownershipEstimate(v: Pick<Vehicle, 'purchasePrice' | 'resaleEstimate' | 'purchaseDate'>, ledger: LedgerItem[], categories: LedgerCategory[], today = todayIso()): OwnershipEstimate | undefined {
  if (!v.purchaseDate) return undefined;
  const months = Math.max(1, daysBetween(v.purchaseDate, today) / 30.4375);
  const cash = filterLedger(ledger, { from: v.purchaseDate, categories }).reduce((a, i) => a + i.amount, 0);
  const assumptions = [`Recorded costs included: ${categories.join(', ') || 'none'}.`, 'Purchase price is not counted as cash; only depreciation is.'];
  let depreciation: number | undefined;
  if (v.purchasePrice !== undefined && v.resaleEstimate !== undefined) {
    depreciation = Math.max(0, v.purchasePrice - v.resaleEstimate);
    assumptions.push(`Depreciation = purchase price - your resale estimate (${v.resaleEstimate}). This is your assumption, not a market valuation.`);
  } else assumptions.push('No depreciation included: add a purchase price and your own resale estimate to include it.');
  const total = cash + (depreciation ?? 0);
  return { months: round(months, 1), cash, depreciation, total, perMonth: total / months, assumptions };
}

/** Possible duplicate: same vehicle, same amount and category, dates within one day. */
export function findDuplicateExpense(existing: Expense[], candidate: { date: string; amount: number; category: ExpenseCategory }, ignoreId?: string): Expense | undefined {
  return existing.find(x => x.id !== ignoreId && x.category === candidate.category && Math.abs(x.amount - candidate.amount) < 0.005 && Math.abs(daysBetween(x.date, candidate.date)) <= 1);
}
export function findDuplicateFuel(existing: FuelEntry[], c: { date: string; odometer: number; quantity: number }, ignoreId?: string): FuelEntry | undefined {
  return existing.find(x => x.id !== ignoreId && x.date === c.date && (x.odometer === c.odometer || Math.abs(x.quantity - c.quantity) < 0.005));
}
