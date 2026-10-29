import { addDays, addMonths, daysBetween, todayIso } from './calc';
import type { IntervalSource, MaintenanceTask, ServiceRecord, Vehicle } from './types';

/**
 * Maintenance templates. IMPORTANT: the intervals below are GENERIC STARTING POINTS, not
 * manufacturer figures. They are labelled `generic-default` in the UI and every one of them
 * is editable. Where an owner has the manual, they should replace them and mark the source
 * as 'manufacturer'. Tasks are applied only where they make sense for the drivetrain,
 * cooling system and fuel type, so an EV never gets an oil change and a belt scooter never
 * gets a chain lube.
 */
export interface TaskTemplate {
  key: string; name: string; intervalKm?: number; intervalMonths?: number;
  applies: (v: Pick<Vehicle, 'fuelType' | 'drive' | 'cooling' | 'category'>) => boolean;
}

const ice = (v: Pick<Vehicle, 'fuelType'>) => v.fuelType !== 'electric';
const ev = (v: Pick<Vehicle, 'fuelType'>) => v.fuelType === 'electric';

export const TEMPLATES: TaskTemplate[] = [
  { key: 'engine-oil', name: 'Engine oil change', intervalKm: 3000, intervalMonths: 6, applies: ice },
  { key: 'oil-filter', name: 'Oil filter change', intervalKm: 6000, intervalMonths: 12, applies: v => ice(v) && v.category !== 'scooter' },
  { key: 'air-filter', name: 'Air filter clean / replace', intervalKm: 6000, intervalMonths: 12, applies: ice },
  { key: 'spark-plug', name: 'Spark plug check / replace', intervalKm: 10000, intervalMonths: 24, applies: v => v.fuelType === 'petrol' || v.fuelType === 'cng' || v.fuelType === 'hybrid' },
  { key: 'chain-lube', name: 'Chain clean and lube', intervalKm: 500, applies: v => v.drive === 'chain' },
  { key: 'chain-adjust', name: 'Chain tension / sprocket inspection', intervalKm: 2000, intervalMonths: 6, applies: v => v.drive === 'chain' },
  { key: 'belt-cvt', name: 'CVT belt and roller inspection', intervalKm: 10000, intervalMonths: 12, applies: v => v.drive === 'belt' && v.category.includes('scooter') },
  { key: 'belt-final', name: 'Drive belt inspection', intervalKm: 10000, intervalMonths: 12, applies: v => v.drive === 'belt' && !v.category.includes('scooter') },
  { key: 'final-drive-oil', name: 'Final drive (shaft) oil', intervalKm: 20000, intervalMonths: 24, applies: v => v.drive === 'shaft' },
  { key: 'gear-oil', name: 'Transmission / gear oil (scooters)', intervalKm: 10000, intervalMonths: 12, applies: v => ice(v) && v.category.includes('scooter') },
  { key: 'coolant', name: 'Coolant replacement', intervalMonths: 24, intervalKm: 24000, applies: v => v.cooling === 'liquid' },
  { key: 'brake-inspect', name: 'Brake pads and discs / shoes inspection', intervalKm: 5000, intervalMonths: 6, applies: () => true },
  { key: 'brake-fluid', name: 'Brake fluid replacement (disc brakes)', intervalMonths: 24, applies: () => true },
  { key: 'tyre-check', name: 'Tyre pressure and wear check', intervalMonths: 3, applies: () => true },
  { key: 'battery-check', name: '12 V battery and electrics check', intervalMonths: 6, applies: () => true },
  { key: 'general', name: 'General inspection / periodic service', intervalKm: 5000, intervalMonths: 6, applies: ice },
  { key: 'ev-battery', name: 'EV traction battery and connector inspection', intervalMonths: 6, applies: ev },
  { key: 'ev-service', name: 'EV periodic service (brakes, cables, software)', intervalKm: 6000, intervalMonths: 6, applies: ev },
];

export const applicableTemplates = (v: Pick<Vehicle, 'fuelType' | 'drive' | 'cooling' | 'category'>) => TEMPLATES.filter(t => t.applies(v));

export interface TaskBaseline { odo?: number; date?: string }

/** Create the initial task set for a vehicle. Counting starts from the given baseline (purchase or "last done"). */
export function buildInitialTasks(v: Vehicle, baseline: TaskBaseline, now = new Date().toISOString(), newId: () => string): MaintenanceTask[] {
  return applicableTemplates(v).map(t => ({
    id: newId(), vehicleId: v.id, key: t.key, name: t.name,
    intervalKm: t.intervalKm, intervalMonths: t.intervalMonths,
    source: 'generic-default' as IntervalSource,
    sourceNote: 'Generic starting interval. Replace with the owner\'s manual figure.',
    baselineOdo: baseline.odo, baselineDate: baseline.date, enabled: true,
    createdAt: now, updatedAt: now,
  }));
}

export type DueStatus = 'ok' | 'soon' | 'due' | 'overdue' | 'unknown';

export interface DueInfo {
  status: DueStatus;
  kmRemaining?: number;
  daysRemaining?: number;
  dueOdo?: number;
  dueDate?: string;
  lastDone?: { date: string; odometer?: number };
  basis: 'last-service' | 'baseline' | 'none';
  trigger?: 'km' | 'time';
  message: string;
}

export function lastCompletion(task: Pick<MaintenanceTask, 'key'>, services: ServiceRecord[]): ServiceRecord | undefined {
  const done = services.filter(s => !s.deletedAt && s.taskKeys.includes(task.key));
  return done.sort((a, b) => b.date.localeCompare(a.date) || (b.odometer ?? 0) - (a.odometer ?? 0))[0];
}

/**
 * Due when EITHER threshold is reached. 'soon' = within 10% of the km interval or 14 days.
 * 'overdue' = past due by more than 20% of the km interval or 30 days. Missing data never produces a false 'ok':
 * with no starting point the task is 'unknown'; with no current odometer only the time rule can be evaluated.
 */
export function computeDue(task: MaintenanceTask, services: ServiceRecord[], currentOdo: number | undefined, today = todayIso()): DueInfo {
  const last = lastCompletion(task, services);
  const baseOdo = last ? last.odometer : task.baselineOdo;
  const baseDate = last ? last.date : task.baselineDate;
  const basis: DueInfo['basis'] = last ? 'last-service' : (baseOdo !== undefined || baseDate) ? 'baseline' : 'none';
  const lastDone = last ? { date: last.date, odometer: last.odometer } : undefined;

  if (task.intervalKm === undefined && task.intervalMonths === undefined) {
    return { status: 'unknown', basis, lastDone, message: 'No interval set. Add a distance or time interval.' };
  }
  const hasKm = task.intervalKm !== undefined && baseOdo !== undefined;
  const hasTime = task.intervalMonths !== undefined && !!baseDate;
  if (!hasKm && !hasTime) {
    return { status: 'unknown', basis, lastDone, message: 'No starting point yet. Record when this was last done.' };
  }

  let dueOdo: number | undefined, kmRemaining: number | undefined;
  if (hasKm) {
    dueOdo = baseOdo! + task.intervalKm!;
    if (currentOdo !== undefined) kmRemaining = dueOdo - currentOdo;
  }
  let dueDate: string | undefined, daysRemaining: number | undefined;
  if (hasTime) {
    dueDate = addMonths(baseDate!, task.intervalMonths!);
    daysRemaining = daysBetween(today, dueDate);
  }

  const kmLate = kmRemaining !== undefined && kmRemaining <= 0;
  const timeLate = daysRemaining !== undefined && daysRemaining <= 0;
  const kmVeryLate = kmRemaining !== undefined && task.intervalKm !== undefined && -kmRemaining > task.intervalKm * 0.2;
  const timeVeryLate = daysRemaining !== undefined && -daysRemaining > 30;
  const kmSoon = kmRemaining !== undefined && task.intervalKm !== undefined && kmRemaining <= task.intervalKm * 0.1;
  const timeSoon = daysRemaining !== undefined && daysRemaining <= 14;

  let status: DueStatus = 'ok';
  let trigger: DueInfo['trigger'];
  if (kmVeryLate || timeVeryLate) { status = 'overdue'; trigger = kmVeryLate ? 'km' : 'time'; }
  else if (kmLate || timeLate) { status = 'due'; trigger = kmLate ? 'km' : 'time'; }
  else if (kmSoon || timeSoon) { status = 'soon'; trigger = kmSoon ? 'km' : 'time'; }

  const parts: string[] = [];
  if (kmRemaining !== undefined) parts.push(kmRemaining >= 0 ? `${Math.round(kmRemaining).toLocaleString('en-IN')} km left` : `${Math.round(-kmRemaining).toLocaleString('en-IN')} km over`);
  if (daysRemaining !== undefined) parts.push(daysRemaining >= 0 ? `${daysRemaining} days left` : `${-daysRemaining} days over`);
  if (task.intervalKm !== undefined && baseOdo !== undefined && currentOdo === undefined) parts.push('add an odometer reading to track distance');
  if (task.intervalKm !== undefined && baseOdo === undefined && hasTime) parts.push('distance rule needs a last-done odometer');
  return { status, kmRemaining, daysRemaining, dueOdo, dueDate, lastDone, basis, trigger, message: parts.join(' · ') };
}

export const STATUS_RANK: Record<DueStatus, number> = { overdue: 0, due: 1, soon: 2, unknown: 3, ok: 4 };

export function sortByUrgency<T extends { due: DueInfo }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const r = STATUS_RANK[a.due.status] - STATUS_RANK[b.due.status];
    if (r) return r;
    const ak = a.due.kmRemaining ?? Infinity, bk = b.due.kmRemaining ?? Infinity;
    const ad = a.due.daysRemaining ?? Infinity, bd = b.due.daysRemaining ?? Infinity;
    return Math.min(ad, ak / 40) - Math.min(bd, bk / 40);
  });
}

export const expiryStatus = (expiry: string | undefined, reminderDays: number, today = todayIso()): 'none' | 'ok' | 'soon' | 'expired' => {
  if (!expiry) return 'none';
  if (expiry < today) return 'expired';
  return expiry <= addDays(today, reminderDays) ? 'soon' : 'ok';
};
