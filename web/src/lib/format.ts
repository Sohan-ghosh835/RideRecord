import type { Category, SpecKey, SpecValue, Vehicle } from '../domain/types';

export const inr = (n: number | undefined, dp = 0) =>
  n === undefined || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: dp, minimumFractionDigits: dp }).format(n);
export const num = (n: number | undefined, dp = 0) =>
  n === undefined || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: dp, minimumFractionDigits: dp }).format(n);
export const km = (n: number | undefined) => (n === undefined ? '—' : `${num(n)} km`);
export const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const fmtMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};
export const pct = (n?: number) => (n === undefined ? '' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);

export const vehicleTitle = (v: Pick<Vehicle, 'manufacturer' | 'model' | 'nickname'>) => v.nickname?.trim() || `${v.manufacturer} ${v.model}`;
export const vehicleSubtitle = (v: Pick<Vehicle, 'manufacturer' | 'model' | 'variant' | 'year' | 'nickname'>) =>
  [v.nickname?.trim() ? `${v.manufacturer} ${v.model}` : undefined, v.variant, String(v.year)].filter(Boolean).join(' · ');

const CONVERT: Partial<Record<SpecKey, (v: number, unit?: string) => string | undefined>> = {
  power: (v, u) => (u === 'bhp' ? `≈ ${(v * 0.7457).toFixed(1)} kW` : u === 'kW' ? `≈ ${(v * 1.341).toFixed(1)} bhp` : undefined),
  claimedEfficiency: (v, u) => (u === 'km/L' ? `≈ ${(100 / v).toFixed(1)} L/100 km` : u === 'L/100 km' ? `≈ ${(100 / v).toFixed(1)} km/L` : undefined),
  battery: (v, u) => (u === 'Wh' ? `= ${(v / 1000).toFixed(2)} kWh` : undefined),
};

/** Show the figure as published, plus a labelled conversion only when it helps. */
export function specText(key: SpecKey, s: SpecValue): { main: string; conversion?: string } {
  const plain = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n); // no forced decimals: 124 cc, not 124.00 cc
  const main = s.original ?? (typeof s.value === 'number' ? `${plain(s.value)}${s.unit ? ' ' + s.unit : ''}` : String(s.value));
  const conv = typeof s.value === 'number' ? CONVERT[key]?.(s.value, s.unit) : undefined;
  return { main, conversion: conv };
}

export function categoryKind(c: Category): 'scooter' | 'bike' | 'offroad' {
  return c === 'scooter' || c === 'electric-scooter' || c === 'moped' ? 'scooter' : c === 'dirt' || c === 'dual-sport' || c === 'adventure' ? 'offroad' : 'bike';
}

export function download(name: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formula injection
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
