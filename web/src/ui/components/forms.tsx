import { useState, type FormEvent, type ReactNode } from 'react';
import { newId, save, type VehicleBundle } from '../../db/repo';
import { findDuplicateExpense, findDuplicateFuel, round, todayIso, validateFuelEntry, validateOdometer, type Validation } from '../../domain/calc';
import { DOC_LABEL, EXPENSE_CATEGORIES, EXPENSE_LABEL, type DocType, type DocumentRec, type Expense, type ExpenseCategory, type FuelEntry, type IntervalSource, type MaintenanceTask, type OdometerReading, type ServiceRecord } from '../../domain/types';
import { ACCEPT, capacityOf, checkFile, quantityUnit, saveFileAsDocument } from '../../lib/vehicle';
import { km } from '../../lib/format';
import { useApp } from '../../lib/store';
import { Feedback, Field, Modal } from './kit';

const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));
const optNum = (s: string) => (s.trim() === '' ? undefined : Number(s));
const optStr = (s: string) => (s.trim() === '' ? undefined : s.trim());

interface FormProps { bundle: VehicleBundle; onClose: () => void }

/** Shared modal + submit handling: errors block, warnings need acknowledgement, saving is guarded against double-taps. */
function useFormFlow(onClose: () => void, doneMessage: string) {
  const { bump, toast } = useApp();
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run(check: () => Validation | Promise<Validation>, commit: () => Promise<void>) {
    if (busy) return;
    const v = await check();
    setErrors(v.errors); setWarnings(v.warnings);
    if (v.errors.length) return;
    if (v.warnings.length && !ack) return;
    setBusy(true);
    try { await commit(); bump(); toast(doneMessage); onClose(); }
    catch (e) { setErrors([`Could not save: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`]); }
    finally { setBusy(false); }
  }
  return { errors, warnings, ack, setAck, busy, run, setErrors, setWarnings };
}

function FormModal({ title, onClose, onSubmit, busy, children, submitLabel = 'Save' }: { title: string; onClose: () => void; onSubmit: () => void; busy: boolean; children: ReactNode; submitLabel?: string }) {
  const handle = (e: FormEvent) => { e.preventDefault(); onSubmit(); };
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" form="rr-form" className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></>}>
      <form id="rr-form" onSubmit={handle} noValidate className="col">{children}</form>
    </Modal>
  );
}

function ReceiptField({ file, setFile, error }: { file?: File; setFile: (f?: File) => void; error?: string }) {
  return (
    <Field label="Receipt or invoice (optional)" hint="Image or PDF, up to 8 MB. Stored on this device only." full>
      <input type="file" accept={ACCEPT} onChange={e => setFile(e.target.files?.[0])} aria-invalid={!!error} />
      {file && <span className="small muted">{file.name}</span>}
      {error && <span className="small" style={{ color: 'var(--red)' }}>{error}</span>}
    </Field>
  );
}

async function attach(file: File | undefined, vehicleId: string, title: string, existing?: string): Promise<string | undefined> {
  if (!file) return existing;
  const bad = checkFile(file);
  if (bad) throw new Error(bad);
  return (await saveFileAsDocument(vehicleId, file, 'receipt', title)).id;
}

// ---------------- Fuel / charging ----------------

export function FuelForm({ bundle, entry, onClose }: FormProps & { entry?: FuelEntry }) {
  const v = bundle.vehicle;
  const ev = v.fuelType === 'electric';
  const unit = quantityUnit(v);
  const [date, setDate] = useState(entry?.date ?? todayIso());
  const [odo, setOdo] = useState(entry ? String(entry.odometer) : '');
  const [qty, setQty] = useState(entry ? String(entry.quantity) : '');
  const [price, setPrice] = useState(entry?.pricePerUnit ? String(entry.pricePerUnit) : '');
  const [total, setTotal] = useState(entry ? String(entry.total) : '');
  const [totalTouched, setTotalTouched] = useState(!!entry);
  const [full, setFull] = useState(entry?.fullTank ?? true);
  const [skipped, setSkipped] = useState(entry?.skippedPrevious ?? false);
  const [station, setStation] = useState(entry?.station ?? '');
  const [payment, setPayment] = useState(entry?.payment ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [file, setFile] = useState<File>();
  const f = useFormFlow(onClose, entry ? 'Entry updated' : ev ? 'Charging session saved' : 'Fuel entry saved');

  const recalc = (q: string, p: string) => {
    if (!totalTouched && q && p && !Number.isNaN(Number(q)) && !Number.isNaN(Number(p))) setTotal(String(round(Number(q) * Number(p))));
  };

  const submit = () => f.run(() => {
    const km_ = toNum(odo), q = toNum(qty), t = toNum(total), p = optNum(price);
    const o = validateOdometer(bundle.readings, { date, km: km_ }, entry?.id);
    const fv = validateFuelEntry({ kind: ev ? 'charge' : 'fuel', quantity: q, pricePerUnit: p, total: t }, capacityOf(v));
    const dup = !o.errors.length && !fv.errors.length ? findDuplicateFuel(bundle.fuel, { date, odometer: km_, quantity: q }, entry?.id) : undefined;
    const warnings = [...o.warnings, ...fv.warnings, ...(dup ? [`There is already an entry on ${dup.date} with the same odometer or quantity. This may be a duplicate.`] : [])];
    return { errors: [...o.errors, ...fv.errors], warnings };
  }, async () => {
    const receiptId = await attach(file, v.id, `${ev ? 'Charging' : 'Fuel'} receipt ${date}`, entry?.receiptId);
    const rec: FuelEntry = {
      id: entry?.id ?? newId(), vehicleId: v.id, kind: ev ? 'charge' : 'fuel', date, odometer: toNum(odo), quantity: toNum(qty),
      pricePerUnit: optNum(price), total: toNum(total), fullTank: full, skippedPrevious: skipped, station: optStr(station), payment: optStr(payment),
      notes: optStr(notes), receiptId, createdAt: entry?.createdAt ?? '', updatedAt: '',
    };
    await save('fuel', rec);
  });

  return (
    <FormModal title={entry ? (ev ? 'Edit charging session' : 'Edit fuel entry') : ev ? 'Log charging session' : 'Log fuel'} onClose={onClose} onSubmit={submit} busy={f.busy}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} required /></Field>
        <Field label="Odometer (km)" hint={bundle.lastOdo ? `Last known: ${km(bundle.lastOdo.km)}` : 'First reading for this vehicle'}>
          <input type="number" inputMode="decimal" value={odo} onChange={e => setOdo(e.target.value)} autoFocus min={0} step="any" required />
        </Field>
        <Field label={`Quantity (${unit})`}><input type="number" inputMode="decimal" value={qty} onChange={e => { setQty(e.target.value); recalc(e.target.value, price); }} step="any" min={0} required /></Field>
        <Field label={`Price per ${unit} (optional)`}><input type="number" inputMode="decimal" value={price} onChange={e => { setPrice(e.target.value); recalc(qty, e.target.value); }} step="any" min={0} /></Field>
        <Field label="Total paid (₹)" hint={!totalTouched && price ? 'Filled in from quantity × price. Edit if the bill differs.' : undefined}>
          <input type="number" inputMode="decimal" value={total} onChange={e => { setTotal(e.target.value); setTotalTouched(true); }} step="any" min={0} required />
        </Field>
        <Field label={ev ? 'Charging location (optional)' : 'Fuel station (optional)'}><input value={station} onChange={e => setStation(e.target.value)} maxLength={80} /></Field>
        <label className="check full"><input type="checkbox" checked={full} onChange={e => setFull(e.target.checked)} /><span><strong>{ev ? 'Charged to full' : 'Filled to full (tank full)'}</strong><br /><span className="small muted">Full-to-full fills give the most dependable efficiency figure. Untick for a partial top-up; it is still counted in the next full-to-full calculation.</span></span></label>
        <label className="check full"><input type="checkbox" checked={skipped} onChange={e => setSkipped(e.target.checked)} /><span><strong>I did not log an earlier {ev ? 'charge' : 'fill'}</strong><br /><span className="small muted">Efficiency across a gap can't be measured, so this entry will start a fresh measurement instead.</span></span></label>
        <Field label="Payment method (optional)"><input value={payment} onChange={e => setPayment(e.target.value)} maxLength={40} placeholder="UPI, cash, card…" /></Field>
        <Field label="Notes (optional)"><input value={notes} onChange={e => setNotes(e.target.value)} maxLength={200} /></Field>
        <ReceiptField file={file} setFile={setFile} />
      </div>
      <Feedback {...f} />
    </FormModal>
  );
}

// ---------------- Expense ----------------

export function ExpenseForm({ bundle, entry, onClose }: FormProps & { entry?: Expense }) {
  const v = bundle.vehicle;
  const [date, setDate] = useState(entry?.date ?? todayIso());
  const [category, setCategory] = useState<ExpenseCategory>(entry?.category ?? 'repair');
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [odo, setOdo] = useState(entry?.odometer !== undefined ? String(entry.odometer) : '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [file, setFile] = useState<File>();
  const f = useFormFlow(onClose, entry ? 'Expense updated' : 'Expense saved');

  const submit = () => f.run(() => {
    const errors: string[] = [], warnings: string[] = [];
    const a = toNum(amount);
    if (!Number.isFinite(a) || a <= 0) errors.push('Enter an amount greater than 0.');
    if (!date) errors.push('Enter a date.');
    if (odo.trim()) { const o = validateOdometer(bundle.readings, { date, km: toNum(odo) }, entry?.id); errors.push(...o.errors); warnings.push(...o.warnings); }
    if (!errors.length) {
      const dup = findDuplicateExpense(bundle.expenses, { date, amount: a, category }, entry?.id);
      if (dup) warnings.push(`A ${EXPENSE_LABEL[category].toLowerCase()} expense of the same amount was already recorded on ${dup.date}. This may be a duplicate.`);
    }
    return { errors, warnings };
  }, async () => {
    const receiptId = await attach(file, v.id, `Expense receipt ${date}`, entry?.receiptId);
    const rec: Expense = { id: entry?.id ?? newId(), vehicleId: v.id, date, category, amount: toNum(amount), odometer: optNum(odo), notes: optStr(notes), receiptId, createdAt: entry?.createdAt ?? '', updatedAt: '' };
    await save('expenses', rec);
  });

  return (
    <FormModal title={entry ? 'Edit expense' : 'Record expense'} onClose={onClose} onSubmit={submit} busy={f.busy}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} required /></Field>
        <Field label="Amount (₹)"><input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} step="any" min={0} autoFocus required /></Field>
        <Field label="Category" hint="Fuel goes in Fuel and workshop bills in Service, so every rupee is counted once.">
          <select value={category} onChange={e => setCategory(e.target.value as ExpenseCategory)}>{EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{EXPENSE_LABEL[c]}</option>)}</select>
        </Field>
        <Field label="Odometer (optional)"><input type="number" inputMode="decimal" value={odo} onChange={e => setOdo(e.target.value)} step="any" min={0} /></Field>
        {category === 'loan-interest' && <p className="notice info full small">Record only the interest portion of an EMI. The principal repays the purchase price and is not an operating cost.</p>}
        <Field label="Notes (optional)" full><input value={notes} onChange={e => setNotes(e.target.value)} maxLength={200} /></Field>
        <ReceiptField file={file} setFile={setFile} />
      </div>
      <Feedback {...f} />
    </FormModal>
  );
}

// ---------------- Odometer ----------------

export function OdometerForm({ bundle, entry, onClose }: FormProps & { entry?: OdometerReading }) {
  const [date, setDate] = useState(entry?.date ?? todayIso());
  const [reading, setReading] = useState(entry ? String(entry.km) : '');
  const [note, setNote] = useState(entry?.note ?? '');
  const f = useFormFlow(onClose, 'Odometer updated');
  const submit = () => f.run(() => validateOdometer(bundle.readings, { date, km: toNum(reading) }, entry?.id), async () => {
    const rec: OdometerReading = { id: entry?.id ?? newId(), vehicleId: bundle.vehicle.id, date, km: toNum(reading), note: optStr(note), createdAt: entry?.createdAt ?? '', updatedAt: '' };
    await save('odometer', rec);
  });
  return (
    <FormModal title="Update odometer" onClose={onClose} onSubmit={submit} busy={f.busy}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} required /></Field>
        <Field label="Odometer (km)" hint={bundle.lastOdo ? `Last known: ${km(bundle.lastOdo.km)}` : undefined}><input type="number" inputMode="decimal" value={reading} onChange={e => setReading(e.target.value)} autoFocus step="any" min={0} required /></Field>
        <Field label="Note (optional)" full hint="e.g. odometer replaced, or reading taken at a workshop"><input value={note} onChange={e => setNote(e.target.value)} maxLength={120} /></Field>
      </div>
      <Feedback {...f} />
    </FormModal>
  );
}

// ---------------- Service ----------------

export function ServiceForm({ bundle, entry, presetTaskKeys, onClose }: FormProps & { entry?: ServiceRecord; presetTaskKeys?: string[] }) {
  const v = bundle.vehicle;
  const [date, setDate] = useState(entry?.date ?? todayIso());
  const [odo, setOdo] = useState(entry?.odometer !== undefined ? String(entry.odometer) : bundle.lastOdo ? String(bundle.lastOdo.km) : '');
  const [workshop, setWorkshop] = useState(entry?.workshop ?? '');
  const preset = presetTaskKeys?.map(k => bundle.tasks.find(t => t.key === k)?.name).filter(Boolean).join(', ');
  const [work, setWork] = useState(entry?.work ?? preset ?? '');
  const [parts, setParts] = useState(entry?.parts ?? '');
  const [labour, setLabour] = useState(entry ? String(entry.labourCost) : '');
  const [partsCost, setPartsCost] = useState(entry ? String(entry.partsCost) : '');
  const [warranty, setWarranty] = useState(entry?.warranty ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [keys, setKeys] = useState<string[]>(entry?.taskKeys ?? presetTaskKeys ?? []);
  const [file, setFile] = useState<File>();
  const f = useFormFlow(onClose, 'Service recorded');

  const submit = () => f.run(() => {
    const errors: string[] = [], warnings: string[] = [];
    if (!work.trim()) errors.push('Describe the work done.');
    for (const [label, s] of [['Labour cost', labour], ['Parts cost', partsCost]] as const) {
      if (s.trim() && (!Number.isFinite(Number(s)) || Number(s) < 0)) errors.push(`${label} must be 0 or more.`);
    }
    if (odo.trim()) { const o = validateOdometer(bundle.readings, { date, km: toNum(odo) }, entry?.id); errors.push(...o.errors); warnings.push(...o.warnings); }
    else if (keys.some(k => bundle.tasks.find(t => t.key === k)?.intervalKm !== undefined)) warnings.push('No odometer reading entered. Distance-based reminders for the selected tasks will restart from the date only.');
    return { errors, warnings };
  }, async () => {
    const receiptId = await attach(file, v.id, `Service invoice ${date}`, entry?.receiptId);
    const rec: ServiceRecord = {
      id: entry?.id ?? newId(), vehicleId: v.id, date, odometer: optNum(odo), workshop: optStr(workshop), work: work.trim(), parts: optStr(parts),
      labourCost: optNum(labour) ?? 0, partsCost: optNum(partsCost) ?? 0, warranty: optStr(warranty), notes: optStr(notes), taskKeys: keys, receiptId,
      createdAt: entry?.createdAt ?? '', updatedAt: '',
    };
    await save('services', rec);
  });

  const toggle = (k: string) => setKeys(ks => (ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k]));
  return (
    <FormModal title={entry ? 'Edit service record' : 'Log service'} onClose={onClose} onSubmit={submit} busy={f.busy}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} required /></Field>
        <Field label="Odometer (km)"><input type="number" inputMode="decimal" value={odo} onChange={e => setOdo(e.target.value)} step="any" min={0} /></Field>
        <Field label="Workshop (optional)" full><input value={workshop} onChange={e => setWorkshop(e.target.value)} maxLength={80} /></Field>
        <Field label="Work performed" full><textarea value={work} onChange={e => setWork(e.target.value)} maxLength={500} required /></Field>
        <fieldset className="full" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '.6rem .8rem' }}>
          <legend className="small muted">Maintenance tasks completed on this visit</legend>
          {bundle.tasks.length === 0 && <p className="small muted">No maintenance tasks configured for this vehicle.</p>}
          <div className="grid" style={{ gap: '.15rem' }}>
            {[...bundle.tasks].sort((a, b) => a.name.localeCompare(b.name)).map(t => (
              <label className="check" key={t.id} style={{ minHeight: 32 }}><input type="checkbox" checked={keys.includes(t.key)} onChange={() => toggle(t.key)} /><span>{t.name}</span></label>
            ))}
          </div>
        </fieldset>
        <Field label="Parts replaced (optional)" full><input value={parts} onChange={e => setParts(e.target.value)} maxLength={200} /></Field>
        <Field label="Labour cost (₹)"><input type="number" inputMode="decimal" value={labour} onChange={e => setLabour(e.target.value)} step="any" min={0} /></Field>
        <Field label="Parts cost (₹)"><input type="number" inputMode="decimal" value={partsCost} onChange={e => setPartsCost(e.target.value)} step="any" min={0} /></Field>
        <Field label="Warranty details (optional)" full><input value={warranty} onChange={e => setWarranty(e.target.value)} maxLength={160} placeholder="e.g. 6 months on replaced parts" /></Field>
        <Field label="Notes (optional)" full><input value={notes} onChange={e => setNotes(e.target.value)} maxLength={200} /></Field>
        <ReceiptField file={file} setFile={setFile} />
      </div>
      <Feedback {...f} />
    </FormModal>
  );
}

// ---------------- Maintenance task settings ----------------

const SOURCE_LABEL: Record<IntervalSource, string> = { manufacturer: 'Manufacturer / owner\'s manual', 'generic-default': 'Generic starting point', user: 'My own reminder' };

export function TaskForm({ bundle, task, onClose }: FormProps & { task?: MaintenanceTask }) {
  const [name, setName] = useState(task?.name ?? '');
  const [kmI, setKmI] = useState(task?.intervalKm !== undefined ? String(task.intervalKm) : '');
  const [moI, setMoI] = useState(task?.intervalMonths !== undefined ? String(task.intervalMonths) : '');
  const [source, setSource] = useState<IntervalSource>(task ? task.source : 'user');
  const [note, setNote] = useState(task?.sourceNote ?? '');
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const [bOdo, setBOdo] = useState(task?.baselineOdo !== undefined ? String(task.baselineOdo) : '');
  const [bDate, setBDate] = useState(task?.baselineDate ?? '');
  const f = useFormFlow(onClose, 'Maintenance rule saved');

  const submit = () => f.run(() => {
    const errors: string[] = [];
    if (!name.trim()) errors.push('Give the task a name.');
    if (!kmI.trim() && !moI.trim()) errors.push('Set a distance interval, a time interval, or both.');
    for (const [l, s] of [['Distance interval', kmI], ['Time interval', moI]] as const) if (s.trim() && (!(Number(s) > 0))) errors.push(`${l} must be more than 0.`);
    return { errors, warnings: [] };
  }, async () => {
    const rec: MaintenanceTask = {
      id: task?.id ?? newId(), vehicleId: bundle.vehicle.id, key: task?.key ?? `custom-${newId().slice(0, 8)}`, name: name.trim(),
      intervalKm: optNum(kmI), intervalMonths: optNum(moI), source, sourceNote: optStr(note), enabled,
      baselineOdo: optNum(bOdo), baselineDate: optStr(bDate), createdAt: task?.createdAt ?? '', updatedAt: '',
    };
    await save('tasks', rec);
  });

  return (
    <FormModal title={task ? 'Edit maintenance rule' : 'Add maintenance reminder'} onClose={onClose} onSubmit={submit} busy={f.busy}>
      <div className="form-grid">
        <Field label="Task" full><input value={name} onChange={e => setName(e.target.value)} maxLength={80} autoFocus required /></Field>
        <Field label="Every (km)" hint="Leave empty for time only"><input type="number" inputMode="numeric" value={kmI} onChange={e => setKmI(e.target.value)} min={0} step="any" /></Field>
        <Field label="Every (months)" hint="Leave empty for distance only"><input type="number" inputMode="numeric" value={moI} onChange={e => setMoI(e.target.value)} min={0} step="any" /></Field>
        <p className="small muted full">The task becomes due when <strong>either</strong> limit is reached.</p>
        <Field label="Where does this interval come from?" full>
          <select value={source} onChange={e => setSource(e.target.value as IntervalSource)}>{(Object.keys(SOURCE_LABEL) as IntervalSource[]).map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select>
        </Field>
        <Field label="Source note (optional)" full hint="e.g. Owner's manual, page 52"><input value={note} onChange={e => setNote(e.target.value)} maxLength={160} /></Field>
        <Field label="Last done at (km)" hint="Starting point if never logged"><input type="number" inputMode="numeric" value={bOdo} onChange={e => setBOdo(e.target.value)} min={0} step="any" /></Field>
        <Field label="Last done on"><input type="date" value={bDate} max={todayIso()} onChange={e => setBDate(e.target.value)} /></Field>
        <label className="check full"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /><span>Remind me about this task</span></label>
      </div>
      <Feedback {...f} />
    </FormModal>
  );
}

// ---------------- Documents ----------------

export function DocForm({ bundle, onClose }: FormProps) {
  const [type, setType] = useState<DocType>('insurance');
  const [title, setTitle] = useState('');
  const [expiry, setExpiry] = useState('');
  const [days, setDays] = useState('30');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File>();
  const f = useFormFlow(onClose, 'Document stored');
  const submit = () => f.run(() => {
    const errors: string[] = [];
    if (!file) errors.push('Choose an image or PDF to store.');
    else { const bad = checkFile(file); if (bad) errors.push(bad); }
    if (!title.trim()) errors.push('Give the document a title.');
    return { errors, warnings: [] };
  }, async () => {
    await saveFileAsDocument(bundle.vehicle.id, file!, type, title.trim(), { expiry: optStr(expiry), reminderDays: optNum(days) ?? 30, notes: optStr(notes) } as Partial<DocumentRec>);
  });
  return (
    <FormModal title="Add document" onClose={onClose} onSubmit={submit} busy={f.busy}>
      <div className="form-grid">
        <Field label="Type"><select value={type} onChange={e => { setType(e.target.value as DocType); if (!title) setTitle(DOC_LABEL[e.target.value as DocType]); }}>{(Object.keys(DOC_LABEL) as DocType[]).filter(d => d !== 'receipt').map(d => <option key={d} value={d}>{DOC_LABEL[d]}</option>)}</select></Field>
        <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} required /></Field>
        <Field label="Expiry date (optional)"><input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></Field>
        <Field label="Remind me (days before)"><input type="number" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} min={0} /></Field>
        <Field label="Notes (optional)" full><input value={notes} onChange={e => setNotes(e.target.value)} maxLength={200} /></Field>
        <ReceiptField file={file} setFile={setFile} />
      </div>
      <Feedback {...f} />
    </FormModal>
  );
}
