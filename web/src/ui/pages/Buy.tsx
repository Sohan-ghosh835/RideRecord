import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createVehicleWithTasks, getMeta, newId, setMeta } from '../../db/repo';
import { todayIso } from '../../domain/calc';
import { DOC_CHECKLIST, emiFor, onRoadTotal, plan, schedule, type LoanMethod } from '../../domain/loan';
import type { CatalogEntry, Loan, Vehicle } from '../../domain/types';
import { inr } from '../../lib/format';
import { useApp, useCatalog } from '../../lib/store';
import { CatalogImage, ColourPicker, ErrorBox, Field, Loading, Metric, Notice } from '../components/kit';

interface Draft {
  entryId: string; colour?: string;
  exShowroom: string; roadTax: string; insurance: string; handling: string; accessories: string; discount: string;
  down: string; rate: string; months: string; method: LoanMethod; fee: string; income: string;
  checked: string[];
}
const EMPTY: Draft = { entryId: '', exShowroom: '', roadTax: '', insurance: '', handling: '', accessories: '', discount: '', down: '', rate: '', months: '36', method: 'reducing', fee: '', income: '', checked: [] };

const n = (s: string) => { const x = Number(s); return s.trim() !== '' && Number.isFinite(x) && x >= 0 ? x : 0; };
const label = (e: CatalogEntry) => `${e.model}${e.generation ? ` · ${e.generation}` : ''}`;

export default function Buy() {
  const catalog = useCatalog();
  const [d, setD] = useState<Draft>(EMPTY);
  const [ready, setReady] = useState(false);

  // The plan is kept on this device so you can come back to it. Income is never saved.
  useEffect(() => { void getMeta<Draft>('buyDraft').then(v => { if (v) setD({ ...EMPTY, ...v, income: '' }); setReady(true); }); }, []);
  useEffect(() => { if (ready) void setMeta('buyDraft', { ...d, income: '' }); }, [d, ready]);

  if (catalog.loading || !ready) return <main className="page"><Loading label="Loading" /></main>;
  if (catalog.error || !catalog.data) return <main className="page"><ErrorBox error={catalog.error ?? 'Catalog unavailable'} /></main>;
  return <Planner catalog={catalog.data} d={d} setD={setD} />;
}

function Planner({ catalog, d, setD }: { catalog: CatalogEntry[]; d: Draft; setD: (f: (p: Draft) => Draft) => void }) {
  const nav = useNavigate();
  const { bump, toast } = useApp();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(p => ({ ...p, [k]: v }));
  const entry = catalog.find(c => c.id === d.entryId);
  const brands = useMemo(() => [...new Set(catalog.map(c => c.manufacturer))].sort(), [catalog]);
  const [brand, setBrand] = useState(entry?.manufacturer ?? '');
  const models = useMemo(() => catalog.filter(c => c.manufacturer === brand).sort((a, b) => a.model.localeCompare(b.model)), [catalog, brand]);

  const onRoad = onRoadTotal({ exShowroom: n(d.exShowroom), roadTax: n(d.roadTax), insurance: n(d.insurance), handling: n(d.handling), accessories: n(d.accessories), discount: n(d.discount) });
  const down = n(d.down), months = Math.round(n(d.months)), rate = n(d.rate), fee = n(d.fee);
  const p = useMemo(() => plan({ onRoad, downPayment: down, ratePct: rate, months, method: d.method, processingFee: fee }), [onRoad, down, rate, months, d.method, fee]);
  const rows = useMemo(() => schedule(d.method, p.financed, rate, months), [d.method, p.financed, rate, months]);
  const income = n(d.income);

  const problems: string[] = [];
  if (d.exShowroom.trim() === '' || n(d.exShowroom) <= 0) problems.push('Enter the ex-showroom price from your dealer quotation.');
  if (down > onRoad && onRoad > 0) problems.push('The down payment is more than the on-road price, so no loan is needed.');
  if (rate > 40) problems.push('A rate above 40% a year looks like a typing mistake.');
  if (months < 1 || months > 120) problems.push('Tenure should be between 1 and 120 months.');
  const ok = problems.length === 0 && p.financed > 0 && months > 0;

  const tenures = [12, 24, 36, 48, 60].map(m => { const e = emiFor(d.method, p.financed, rate, m); return { m, emi: e, interest: Math.max(0, e * m - p.financed) }; });
  const toggle = (k: string) => set('checked', d.checked.includes(k) ? d.checked.filter(x => x !== k) : [...d.checked, k]);
  const total = DOC_CHECKLIST.reduce((a, g) => a + g.items.length, 0);

  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [firstEmi, setFirstEmi] = useState('');
  const [lender, setLender] = useState('');
  const [err, setErr] = useState('');

  async function addToGarage() {
    if (!entry) { setErr('Pick the bike first.'); return; }
    if (purchaseDate > todayIso()) { setErr('Purchase date cannot be in the future. Use this once you have bought the bike.'); return; }
    if (ok && !firstEmi) { setErr('Enter the date of your first EMI.'); return; }
    const now = new Date().toISOString();
    const loan: Loan | undefined = ok ? { principal: p.financed, ratePct: rate, tenureMonths: months, method: d.method, emi: p.emi, firstEmiDate: firstEmi, downPayment: down || undefined, processingFee: fee || undefined, lender: lender.trim() || undefined } : undefined;
    const year = Math.min(new Date().getFullYear(), entry.yearTo ?? 9999);
    const v: Vehicle = {
      id: newId(), manufacturer: entry.manufacturer, model: entry.model, year, category: entry.category, fuelType: entry.fuelType, drive: entry.fuelType === 'electric' ? 'electric' : entry.drive,
      cooling: entry.cooling, catalogId: entry.id, catalogUpdatedAt: entry.updatedAt, isCustom: false, colour: d.colour, specSnapshot: structuredClone(entry.specs), specOverrides: {},
      sources: entry.sources, ownership: 'new', purchaseDate, purchasePrice: onRoad > 0 ? onRoad : undefined, loan, createdAt: now, updatedAt: now,
    };
    try {
      const { vehicle } = await createVehicleWithTasks(v, { date: purchaseDate }, false);
      bump(); toast(`${vehicle.manufacturer} ${vehicle.model} added to your garage`); nav(`/v/${vehicle.id}/docs`);
    } catch (e) { setErr(`Could not save: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`); }
  }

  return (
    <main className="page stack-lg">
      <div><h1>Buy a new bike</h1><p className="muted">Pick the bike and colour, add the dealer's quotation, and see the EMI before you commit. Nothing leaves this device.</p></div>

      <section className="card col">
        <h2>1. Your bike</h2>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          {entry ? <CatalogImage entry={entry} colour={d.colour} className="glyph big" /> : null}
          <div className="form-grid grow" style={{ minWidth: 240 }}>
            <Field label="Manufacturer"><select value={brand} onChange={e => { setBrand(e.target.value); setD(p => ({ ...p, entryId: '', colour: undefined })); }}><option value="">Choose…</option>{brands.map(b => <option key={b}>{b}</option>)}</select></Field>
            <Field label="Model"><select value={d.entryId} disabled={!brand} onChange={e => setD(p => ({ ...p, entryId: e.target.value, colour: undefined }))}><option value="">Choose…</option>{models.map(m => <option key={m.id} value={m.id}>{label(m)}</option>)}</select></Field>
          </div>
        </div>
        {entry && <ColourPicker catalogId={entry.id} manufacturer={entry.manufacturer} model={entry.model} value={d.colour} onChange={c => set('colour', c)} />}
      </section>

      <section className="card col">
        <h2>2. On-road price</h2>
        <p className="muted small">RideRecord doesn't know current prices, so type them from your dealer's itemised quotation. Prices change, and road tax and insurance differ by state and rider.</p>
        <div className="form-grid">
          <Field label="Ex-showroom price (₹)"><input type="number" inputMode="decimal" min={0} value={d.exShowroom} onChange={e => set('exShowroom', e.target.value)} /></Field>
          <Field label="Road tax / RTO (₹)"><input type="number" inputMode="decimal" min={0} value={d.roadTax} onChange={e => set('roadTax', e.target.value)} /></Field>
          <Field label="Insurance (₹)"><input type="number" inputMode="decimal" min={0} value={d.insurance} onChange={e => set('insurance', e.target.value)} /></Field>
          <Field label="Handling, registration, other charges (₹)"><input type="number" inputMode="decimal" min={0} value={d.handling} onChange={e => set('handling', e.target.value)} /></Field>
          <Field label="Accessories / extended warranty (₹)"><input type="number" inputMode="decimal" min={0} value={d.accessories} onChange={e => set('accessories', e.target.value)} /></Field>
          <Field label="Discount / exchange bonus (₹)"><input type="number" inputMode="decimal" min={0} value={d.discount} onChange={e => set('discount', e.target.value)} /></Field>
        </div>
        <div className="metric"><div className="label">On-road price</div><div className="v">{inr(onRoad)}</div></div>
      </section>

      <section className="card col">
        <h2>3. Loan</h2>
        <div className="form-grid">
          <Field label="Down payment (₹)"><input type="number" inputMode="decimal" min={0} value={d.down} onChange={e => set('down', e.target.value)} /></Field>
          <Field label="Interest rate (% a year)"><input type="number" inputMode="decimal" min={0} step="any" value={d.rate} onChange={e => set('rate', e.target.value)} /></Field>
          <Field label="Tenure (months)"><input type="number" inputMode="numeric" min={1} max={120} value={d.months} onChange={e => set('months', e.target.value)} /></Field>
          <Field label="Rate type" hint="Dealers often quote flat rates. A flat rate is much costlier than it sounds."><select value={d.method} onChange={e => set('method', e.target.value as LoanMethod)}><option value="reducing">Reducing balance (standard)</option><option value="flat">Flat rate</option></select></Field>
          <Field label="Processing fee and other loan charges (₹)"><input type="number" inputMode="decimal" min={0} value={d.fee} onChange={e => set('fee', e.target.value)} /></Field>
          <Field label="Your monthly income (₹, optional)" hint="Only used here to judge affordability. It is not saved."><input type="number" inputMode="decimal" min={0} value={d.income} onChange={e => set('income', e.target.value)} /></Field>
        </div>
        {problems.length > 0 && onRoad > 0 && <Notice kind="warn"><ul>{problems.map(x => <li key={x}>{x}</li>)}</ul></Notice>}
      </section>

      <section className="card col" aria-live="polite">
        <h2>Your EMI</h2>
        {!ok ? <p className="muted">Fill in the price, down payment, rate and tenure to see the numbers.</p> : (
          <>
            <div className="metrics wide">
              <Metric label="Monthly EMI" value={inr(p.emi)} note={`${months} months`} />
              <Metric label="Loan amount" value={inr(p.financed)} note={`On-road ${inr(onRoad)} − down ${inr(down)}`} />
              <Metric label="Total interest" value={inr(p.totalInterest)} note={`${inr(p.totalPayable)} repaid in all`} />
              <Metric label="Total you pay" value={inr(p.totalOutlay)} note="Down payment + all EMIs + fees" />
            </div>
            <div className="split-bar" role="img" aria-label={`Of the total repaid, ${inr(p.financed)} is principal and ${inr(p.totalInterest)} is interest`}><span style={{ width: `${(p.financed / p.totalPayable) * 100}%` }} /><span style={{ width: `${(p.totalInterest / p.totalPayable) * 100}%` }} /></div>
            <p className="small muted">Principal {inr(p.financed)} · Interest {inr(p.totalInterest)}{d.method === 'flat' && <> · A flat rate of {rate}% works out to about <strong>{p.effectiveRatePct.toFixed(1)}% a year</strong> on a reducing balance, which is the fair number to compare with a bank loan.</>}</p>
            {income > 0 && <Notice kind={p.emi / income > 0.4 ? 'warn' : 'info'}>This EMI is {Math.round((p.emi / income) * 100)}% of your monthly income. A common rule of thumb is to keep all EMIs under about 40%, but your own expenses decide what is comfortable.</Notice>}
            {fee > 0 && <p className="small muted">Processing and other loan charges ({inr(fee)}) are included in the total, not in the EMI. Banks usually take them upfront.</p>}

            <h3>Compare tenures</h3>
            <div className="table-wrap"><table><thead><tr><th>Tenure</th><th className="num">EMI</th><th className="num">Total interest</th></tr></thead><tbody>{tenures.map(t => <tr key={t.m} style={t.m === months ? { fontWeight: 700 } : undefined}><td>{t.m} months</td><td className="num">{inr(t.emi)}</td><td className="num">{inr(t.interest)}</td></tr>)}</tbody></table></div>

            <details onToggle={e => setShowAll((e.target as HTMLDetailsElement).open)}><summary className="small" style={{ cursor: 'pointer' }}>Month-by-month schedule</summary>
              {showAll && <div className="table-wrap"><table><thead><tr><th>#</th><th className="num">Principal</th><th className="num">Interest</th><th className="num">Balance</th></tr></thead><tbody>{rows.map(r => <tr key={r.n}><td>{r.n}</td><td className="num">{inr(r.principal)}</td><td className="num">{inr(r.interest)}</td><td className="num">{inr(r.balance)}</td></tr>)}</tbody></table></div>}
            </details>
            <p className="small faint">An estimate for planning. Your lender's sanctioned EMI, fees and rounding will differ slightly, so trust their schedule once you have it.</p>
          </>
        )}
      </section>

      <section className="card col checklist">
        <div className="row between wrap"><h2>Documents to arrange</h2><span className="small muted">{d.checked.length} of {total} ready</span></div>
        <p className="muted small">A general checklist for buying a new bike on finance. Requirements vary by lender, dealer and state, so confirm the exact list with them. Tick items off as you collect them.</p>
        {DOC_CHECKLIST.map(g => (
          <div key={g.group}>
            <h3 style={{ marginTop: '.6rem' }}>{g.group}</h3>
            {g.note && <p className="small faint">{g.note}</p>}
            {g.items.map(i => <label key={i.key}><input type="checkbox" checked={d.checked.includes(i.key)} onChange={() => toggle(i.key)} /><span><span>{i.label}</span>{i.hint && <><br /><span className="small muted">{i.hint}</span></>}</span></label>)}
          </div>
        ))}
        <p className="small muted">After you buy, you can photograph the invoice, insurance and RC into the bike's document wallet, with expiry reminders.</p>
      </section>

      <section className="card col">
        <h2>Bought it? Add it to your garage</h2>
        {!adding ? <div><button className="btn primary" onClick={() => setAdding(true)} disabled={!entry}>{entry ? 'I have bought this bike' : 'Pick a bike first'}</button></div> : (
          <>
            <p className="muted small">This creates the bike with the on-road price as its purchase price{ok ? ' and saves the loan so you can follow your EMIs' : ''}.</p>
            <div className="form-grid">
              <Field label="Purchase / delivery date"><input type="date" value={purchaseDate} max={todayIso()} onChange={e => setPurchaseDate(e.target.value)} /></Field>
              {ok && <Field label="First EMI date"><input type="date" value={firstEmi} onChange={e => setFirstEmi(e.target.value)} /></Field>}
              {ok && <Field label="Lender (optional)"><input value={lender} onChange={e => setLender(e.target.value)} maxLength={60} /></Field>}
            </div>
            {err && <div className="notice error" role="alert">{err}</div>}
            <div className="row"><button className="btn primary" onClick={addToGarage}>Add to my garage</button><button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button></div>
          </>
        )}
      </section>
    </main>
  );
}
