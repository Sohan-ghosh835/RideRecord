/** Loan / EMI maths for buying a new bike. Pure functions, no rounding until display. */

export type LoanMethod = 'reducing' | 'flat';

export interface OnRoad { exShowroom: number; roadTax: number; insurance: number; handling: number; accessories: number; discount: number }

export const onRoadTotal = (p: OnRoad) => Math.max(0, p.exShowroom + p.roadTax + p.insurance + p.handling + p.accessories - p.discount);

/** Standard reducing-balance EMI. */
export function emiReducing(principal: number, ratePct: number, months: number): number {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = ratePct / 1200;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/** Flat-rate EMI: interest is charged on the full principal for the whole term. */
export function emiFlat(principal: number, ratePct: number, months: number): number {
  if (!(principal > 0) || !(months > 0)) return 0;
  return (principal + (principal * ratePct / 100) * (months / 12)) / months;
}

export const emiFor = (method: LoanMethod, principal: number, ratePct: number, months: number) =>
  method === 'flat' ? emiFlat(principal, ratePct, months) : emiReducing(principal, ratePct, months);

/** The real yearly rate (reducing-balance equivalent) of a given EMI. Bisection on the monthly rate. */
export function effectiveRatePct(principal: number, emi: number, months: number): number {
  if (!(principal > 0) || !(months > 0) || emi * months <= principal) return 0;
  let lo = 0, hi = 1; // monthly rate up to 100%
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const f = Math.pow(1 + mid, months);
    const e = (principal * mid * f) / (f - 1);
    if (e < emi) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 1200;
}

export interface Instalment { n: number; emi: number; interest: number; principal: number; balance: number }

export function schedule(method: LoanMethod, principal: number, ratePct: number, months: number): Instalment[] {
  const emi = emiFor(method, principal, ratePct, months);
  const rows: Instalment[] = [];
  if (!(emi > 0)) return rows;
  let bal = principal;
  const flatInterest = method === 'flat' ? (principal * ratePct / 100) / 12 : 0;
  for (let n = 1; n <= months; n++) {
    const interest = method === 'flat' ? flatInterest : bal * (ratePct / 1200);
    const prin = Math.min(bal, emi - interest);
    bal = Math.max(0, bal - prin);
    rows.push({ n, emi, interest, principal: prin, balance: n === months ? 0 : bal });
  }
  return rows;
}

export interface Plan {
  onRoad: number; downPayment: number; financed: number; emi: number;
  totalInterest: number; totalPayable: number; totalOutlay: number; effectiveRatePct: number; fee: number;
}

export function plan(args: { onRoad: number; downPayment: number; ratePct: number; months: number; method: LoanMethod; processingFee: number }): Plan {
  const financed = Math.max(0, args.onRoad - args.downPayment);
  const emi = emiFor(args.method, financed, args.ratePct, args.months);
  const totalPayable = emi * args.months;
  const totalInterest = Math.max(0, totalPayable - financed);
  return {
    onRoad: args.onRoad, downPayment: args.downPayment, financed, emi, totalInterest, totalPayable, fee: args.processingFee,
    totalOutlay: args.downPayment + totalPayable + args.processingFee,
    effectiveRatePct: effectiveRatePct(financed, emi, args.months),
  };
}

/** How many instalments are due by `today`, given the first EMI date (counted monthly). */
export function instalmentsDue(firstEmiDate: string, today: string, months: number): number {
  const a = new Date(firstEmiDate + 'T00:00:00Z'), b = new Date(today + 'T00:00:00Z');
  if (b < a) return 0;
  let n = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() >= a.getUTCDate()) n += 1;
  return Math.max(0, Math.min(months, n));
}

/** Date of instalment `k` (0-based) given the first EMI date, keeping the day of month where the month allows. */
export function emiDate(firstEmiDate: string, k: number): string {
  const [y, m, d] = firstEmiDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export const DOC_CHECKLIST: { group: string; note?: string; items: { key: string; label: string; hint?: string }[] }[] = [
  { group: 'To get the loan (KYC)', note: 'Lenders differ. Confirm the exact list with the dealer or the bank.', items: [
    { key: 'id', label: 'Photo ID proof', hint: 'e.g. Aadhaar, passport, driving licence, voter ID' },
    { key: 'address', label: 'Address proof', hint: 'Current address, as per the lender\'s accepted list' },
    { key: 'pan', label: 'PAN card' },
    { key: 'photos', label: 'Passport-size photographs' },
    { key: 'income', label: 'Income proof', hint: 'Salary slips, or ITR / Form 16 if self-employed' },
    { key: 'bank', label: 'Recent bank statements' },
    { key: 'mandate', label: 'Signed repayment mandate (ECS / NACH / post-dated cheques)' },
    { key: 'agreement', label: 'Signed loan agreement and sanction letter', hint: 'Read the rate, fees and prepayment charges before signing' },
  ] },
  { group: 'To buy the bike', items: [
    { key: 'quote', label: 'Dealer quotation / proforma invoice', hint: 'Ask for every charge itemised: ex-showroom, road tax, insurance, handling' },
    { key: 'booking', label: 'Booking receipt' },
    { key: 'invoice', label: 'Tax invoice' },
    { key: 'delivery', label: 'Delivery note / challan' },
    { key: 'insurance', label: 'Insurance policy and cover note' },
    { key: 'forms', label: 'Registration forms signed (the dealer normally submits these)' },
    { key: 'sale-cert', label: 'Sale certificate and roadworthiness details from the dealer' },
  ] },
  { group: 'After delivery', items: [
    { key: 'temp', label: 'Temporary registration / receipt until the RC arrives' },
    { key: 'rc', label: 'Registration certificate (RC)', hint: 'With the lender noted on it if the loan is secured against the bike' },
    { key: 'plate', label: 'Number plate fitted' },
    { key: 'warranty', label: 'Warranty card and owner\'s manual' },
    { key: 'keys', label: 'Spare key and tool kit' },
    { key: 'noc', label: 'Loan closure letter / NOC kept safe', hint: 'Needed when the loan ends, to remove the lender from the RC' },
  ] },
];
