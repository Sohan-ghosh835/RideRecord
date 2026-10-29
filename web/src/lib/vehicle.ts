import { newId, save } from '../db/repo';
import type { DocType, DocumentRec, SpecKey, SpecValue, Vehicle } from '../domain/types';

export const effectiveSpecs = (v: Pick<Vehicle, 'specSnapshot' | 'specOverrides'>): Partial<Record<SpecKey, SpecValue>> => ({ ...v.specSnapshot, ...v.specOverrides });

/** Tank (litres) or battery (kWh) capacity, if known. Used only for sanity-check warnings. */
export function capacityOf(v: Vehicle): number | undefined {
  const s = effectiveSpecs(v);
  const pick = v.fuelType === 'electric' ? s.battery : s.tank;
  if (!pick || typeof pick.value !== 'number') return undefined;
  if (v.fuelType === 'electric') return pick.unit === 'Wh' ? pick.value / 1000 : pick.value;
  return pick.value;
}

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const ACCEPT = 'image/*,application/pdf';

export function checkFile(f: File): string | null {
  if (f.size > MAX_FILE_BYTES) return `That file is ${(f.size / 1048576).toFixed(1)} MB. The limit is 8 MB.`;
  if (!(f.type.startsWith('image/') || f.type === 'application/pdf')) return 'Only images and PDF files can be stored.';
  return null;
}

export async function saveFileAsDocument(vehicleId: string, f: File, type: DocType, title: string, extra: Partial<DocumentRec> = {}): Promise<DocumentRec> {
  const now = new Date().toISOString();
  const rec: DocumentRec = {
    id: newId(), vehicleId, type, title, reminderDays: 30, fileName: f.name.slice(0, 120), mime: f.type, size: f.size,
    data: await f.arrayBuffer(), createdAt: now, updatedAt: now, ...extra,
  };
  return save<DocumentRec>('documents', rec);
}

export const maskReg = (r?: string) => (r ? r.slice(0, 2) + '•'.repeat(Math.max(0, r.length - 4)) + r.slice(-2) : '');

/** Unit of the quantity column in fuel entries for this vehicle. */
export const quantityUnit = (v: Pick<Vehicle, 'fuelType'>) => (v.fuelType === 'electric' ? 'kWh' : v.fuelType === 'cng' ? 'kg' : 'L');
export const efficiencyUnit = (v: Pick<Vehicle, 'fuelType'>) => (v.fuelType === 'electric' ? 'km/kWh' : v.fuelType === 'cng' ? 'km/kg' : 'km/L');
