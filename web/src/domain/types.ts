// Core domain types for RideRecord.
// Catalog types describe what the world knows about a model; Vehicle and the record
// types describe what the owner has recorded. The two never share mutable state:
// a Vehicle stores a *snapshot* of catalog specs so catalog refreshes cannot alter it.

export type FuelType = 'petrol' | 'electric' | 'diesel' | 'cng' | 'hybrid' | 'other';
export type Category =
  | 'commuter' | 'scooter' | 'moped' | 'sport' | 'naked' | 'cruiser' | 'adventure'
  | 'touring' | 'dirt' | 'dual-sport' | 'electric-scooter' | 'electric-motorcycle' | 'other';
export type DriveType = 'chain' | 'belt' | 'shaft' | 'electric' | 'unknown';
export type Cooling = 'air' | 'oil' | 'liquid' | 'unknown';
export type ModelStatus = 'current' | 'discontinued' | 'historical';

/** How trustworthy a value is. Never display a seed/estimated value as if it were verified. */
export type Verification = 'verified' | 'seed-unverified' | 'estimated' | 'user-entered';

export type SourceKind = 'manufacturer' | 'manual' | 'distributor' | 'third-party' | 'seed' | 'user';

export interface SourceRef {
  kind: SourceKind;
  label: string;
  url?: string;
  retrieved?: string; // ISO date
}

export interface SpecValue {
  value: number | string;
  unit?: string;
  /** Value exactly as published, kept when a conversion could confuse (e.g. "20.2 bhp @ 6100 rpm"). */
  original?: string;
  verification: Verification;
  /** Index into the entry's sources array. */
  sourceIndex?: number;
}

export type SpecKey =
  | 'displacement' | 'power' | 'torque' | 'tank' | 'battery' | 'range' | 'chargeTime'
  | 'kerbWeight' | 'seatHeight' | 'wheelbase' | 'groundClearance' | 'claimedEfficiency'
  | 'frontTyre' | 'rearTyre' | 'brakes' | 'abs' | 'suspension' | 'transmission' | 'topSpeed'
  | 'warranty';

export interface CatalogEntry {
  id: string;
  manufacturer: string;
  model: string;
  family?: string;
  aliases: string[];
  generation?: string;
  variants?: string[];
  yearFrom: number;
  yearTo: number | null; // null = still produced
  market: string; // ISO country code or 'GLOBAL'
  category: Category;
  fuelType: FuelType;
  drive: DriveType;
  cooling: Cooling;
  status: ModelStatus;
  specs: Partial<Record<SpecKey, SpecValue>>;
  verification: Verification;
  sources: SourceRef[];
  updatedAt: string;
}

export type Ownership = 'new' | 'used' | 'long-owned';

export interface Vehicle {
  id: string;
  nickname?: string;
  manufacturer: string;
  model: string;
  variant?: string;
  year: number;
  category: Category;
  fuelType: FuelType;
  drive: DriveType;
  cooling: Cooling;
  catalogId?: string;
  catalogUpdatedAt?: string;
  isCustom: boolean;
  specSnapshot: Partial<Record<SpecKey, SpecValue>>;
  /** Owner corrections. They sit on top of the snapshot and never touch the global catalog. */
  specOverrides: Partial<Record<SpecKey, SpecValue>>;
  sources: SourceRef[];
  ownership: Ownership;
  purchaseDate?: string;
  purchasePrice?: number;
  initialOdometer?: number;
  resaleEstimate?: number; // owner's own assumption, used only for the optional ownership-cost estimate
  registration?: string; // optional, hidden by default, excluded from reports unless chosen
  reviewQueued?: boolean;
  /** Owner's own photo (downscaled JPEG data URL). Stored on this device only. */
  photo?: string;
  /** Chosen colour, by display name from the catalog colour list. */
  colour?: string;
  /** Finance taken for this bike, if any (entered by the owner). */
  loan?: Loan;
  /** Why the owner removed it from the garage. Every part is optional. */
  removal?: Removal;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export type RemovalReason = 'sold' | 'broke-down' | 'stolen' | 'upgraded' | 'other';
export const REMOVAL_LABEL: Record<RemovalReason, string> = { sold: 'Sold it', 'broke-down': 'Broke down / beyond repair', stolen: 'Stolen or lost', upgraded: 'Upgraded to another bike', other: 'Something else' };

export interface Removal { reason?: RemovalReason; rating?: number; note?: string; at: string }

export interface Loan {
  principal: number;
  /** Annual rate in percent. */
  ratePct: number;
  tenureMonths: number;
  method: 'reducing' | 'flat';
  emi: number;
  /** Date of the first EMI (yyyy-mm-dd). */
  firstEmiDate: string;
  downPayment?: number;
  processingFee?: number;
  lender?: string;
  /** How many instalments' interest has already been recorded as expenses. */
  interestLoggedThrough?: number;
}

interface RecordBase {
  id: string;
  vehicleId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface OdometerReading extends RecordBase {
  date: string;
  km: number;
  note?: string;
}

/** kind 'fuel' => quantity in litres; kind 'charge' => quantity in kWh. */
export interface FuelEntry extends RecordBase {
  kind: 'fuel' | 'charge';
  date: string;
  odometer: number;
  quantity: number;
  pricePerUnit?: number;
  total: number;
  fullTank: boolean;
  /** Owner skipped logging one or more earlier fills; efficiency across this gap is not calculable. */
  skippedPrevious: boolean;
  station?: string;
  payment?: string;
  notes?: string;
  receiptId?: string;
}

export type ExpenseCategory =
  | 'repair' | 'tyres' | 'consumables' | 'insurance' | 'registration' | 'accessories'
  | 'parking' | 'tolls' | 'loan-interest' | 'other';

export interface Expense extends RecordBase {
  date: string;
  category: ExpenseCategory;
  amount: number;
  odometer?: number;
  notes?: string;
  receiptId?: string;
}

export interface ServiceRecord extends RecordBase {
  date: string;
  odometer?: number;
  workshop?: string;
  work: string;
  parts?: string;
  labourCost: number;
  partsCost: number;
  warranty?: string;
  notes?: string;
  /** Maintenance task keys completed by this visit. */
  taskKeys: string[];
  receiptId?: string;
}

export type IntervalSource = 'manufacturer' | 'generic-default' | 'user';

export interface MaintenanceTask extends RecordBase {
  key: string;
  name: string;
  intervalKm?: number;
  intervalMonths?: number;
  source: IntervalSource;
  sourceNote?: string;
  /** Where counting starts when no completion exists yet. */
  baselineOdo?: number;
  baselineDate?: string;
  enabled: boolean;
}

export type DocType = 'insurance' | 'registration' | 'puc' | 'invoice' | 'warranty' | 'manual' | 'receipt' | 'other';

export interface DocumentRec extends RecordBase {
  type: DocType;
  title: string;
  expiry?: string;
  reminderDays: number;
  fileName: string;
  mime: string;
  size: number;
  data: ArrayBuffer;
  notes?: string;
}

export interface Suggestion {
  id: string;
  kind: 'custom-vehicle' | 'spec-correction';
  vehicleId?: string;
  payload: unknown;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  commuter: 'Commuter', scooter: 'Scooter', moped: 'Moped', sport: 'Sport', naked: 'Naked',
  cruiser: 'Cruiser', adventure: 'Adventure', touring: 'Touring', dirt: 'Dirt', 'dual-sport': 'Dual-sport',
  'electric-scooter': 'Electric scooter', 'electric-motorcycle': 'Electric motorcycle', other: 'Other',
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
export const FUEL_TYPES: FuelType[] = ['petrol', 'electric', 'diesel', 'cng', 'hybrid', 'other'];

export const SPEC_LABEL: Record<SpecKey, string> = {
  displacement: 'Displacement', power: 'Max power', torque: 'Max torque', tank: 'Fuel tank',
  battery: 'Battery capacity', range: 'Published range', chargeTime: 'Charging time',
  kerbWeight: 'Kerb / wet weight', seatHeight: 'Seat height', wheelbase: 'Wheelbase',
  groundClearance: 'Ground clearance', claimedEfficiency: 'Claimed efficiency (published)',
  frontTyre: 'Front tyre', rearTyre: 'Rear tyre', brakes: 'Brakes', abs: 'ABS',
  suspension: 'Suspension', transmission: 'Transmission', topSpeed: 'Top speed', warranty: 'Warranty',
};
export const SPEC_KEYS = Object.keys(SPEC_LABEL) as SpecKey[];

export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  repair: 'Repair', tyres: 'Tyres', consumables: 'Consumables', insurance: 'Insurance',
  registration: 'Registration', accessories: 'Accessories', parking: 'Parking', tolls: 'Tolls',
  'loan-interest': 'Loan interest', other: 'Other',
};
export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_LABEL) as ExpenseCategory[];

export const DOC_LABEL: Record<DocType, string> = {
  insurance: 'Insurance policy', registration: 'Registration', puc: 'PUC certificate',
  invoice: 'Purchase invoice', warranty: 'Warranty record', manual: 'Manual',
  receipt: 'Receipt', other: 'Other',
};
