import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { newId, save, softDelete } from '../../db/repo';
import { emiDate, instalmentsDue, schedule } from '../../domain/loan';
import { addDays, buildLedger, costMetrics, filterLedger, ownershipEstimate, todayIso, type LedgerCategory } from '../../domain/calc';
import { EXPENSE_CATEGORIES, EXPENSE_LABEL, type Expense, type Loan } from '../../domain/types';
import { csvEscape, download, fmtDate, inr, num } from '../../lib/format';
import { useApp } from '../../lib/store';
import { Confirm, Empty, Field, Metric, Notice } from '../components/kit';
import { ExpenseForm } from '../components/forms';
import type { VCtx } from './VehicleLayout';

const ALL: LedgerCategory[] = ['fuel', 'charging', 'service', ...EXPENSE_CATEGORIES];
const LABEL = (c: LedgerCategory) => (c === 'fuel' ? 'Fuel' : c === 'charging' ? 'Charging' : c === 'service' ? 'Service bills' : EXPENSE_LABEL[c]);
const PRESETS = [{ k: '30', l: 'Last 30 days', d: 30 }, { k: '90', l: 'Last 90 days', d: 90 }, { k: '365', l: 'Last 12 months', d: 365 }, { k: 'all', l: 'All time' }] as const;

export default function Money({ bundle: b, open }: VCtx) {
  const { bump, toast } = useApp();
  const [preset, setPreset] = useState<string>('365');
  const [cats, setCats] = useState<LedgerCategory[]>(['fuel', 'charging', 'service', 'repair', 'tyres', 'consumables']);
  const [edit, setEdit] = useState<Expense>();
  const [del, setDel] = useState<Expense>();
  const [include, setInclude] = useState<LedgerCategory[]>(['fuel', 'charging', 'service', 'repair', 'tyres', 'consumables', 'insurance', 'registration']);

  const ledger = useMemo(() => buildLedger(b.fuel, b.services, b.expenses), [b]);
  const p = PRESETS.find(x => x.k === preset)!;
  const from = 'd' in p ? addDays(todayIso(), -p.d) : undefined;
  const m = costMetrics(ledger, b.fuel, b.readings, { from, to: todayIso(), operatingCategories: cats });
  const shown = filterLedger(ledger, { from });
  const byCat = ALL.map(c => ({ c, label: LABEL(c), amount: shown.filter(i => i.category === c).reduce((a, i) => a + i.amount, 0) })).filter(x => x.amount > 0);
  const est = ownershipEstimate(b.vehicle, ledger, include);
  const toggle = (set: LedgerCategory[], c: LedgerCategory) => (set.includes(c) ? set.filter(x => x !== c) : [...set, c]);
  const periodText = from ? `${fmtDate(from)} to today` : 'all time';

  const exportCsv = () => {
    const head = ['date', 'category', 'amount_inr', 'odometer_km', 'description'];
    const body = ledger.map(i => [i.date, i.category, i.amount, i.odometer ?? '', i.label].map(csvEscape).join(','));
    download(`riderecord-ledger-${b.vehicle.model.replace(/\W+/g, '-').toLowerCase()}.csv`, [head.join(','), ...body].join('\n'), 'text/csv');
  };

  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div><h2>Costs and expenses</h2><p className="muted small">Fuel and service entries flow in automatically, so nothing is counted twice.</p></div>
        <div className="row no-print"><button className="btn" onClick={exportCsv} disabled={!ledger.length}>Export CSV</button><button className="btn primary" onClick={() => open('expense')}>Record expense</button></div>
      </div>

      {b.vehicle.loan && <LoanCard vehicleId={b.vehicle.id} loan={b.vehicle.loan} onLogged={async through => {
        const loan = b.vehicle.loan!;
        const rows = schedule(loan.method, loan.principal, loan.ratePct, loan.tenureMonths);
        const from = loan.interestLoggedThrough ?? 0;
        for (let i = from; i < through; i++) await save<Expense>('expenses', { id: newId(), vehicleId: b.vehicle.id, date: emiDate(loan.firstEmiDate, i), category: 'loan-interest', amount: Math.round(rows[i].interest * 100) / 100, notes: `Interest part of EMI ${i + 1} of ${loan.tenureMonths}`, createdAt: '', updatedAt: '' });
        await save('vehicles', { ...b.vehicle, loan: { ...loan, interestLoggedThrough: through } });
        bump(); toast(`Recorded interest for ${through - from} EMI${through - from === 1 ? '' : 's'}`);
      }} />}

      <div className="row wrap no-print" role="group" aria-label="Period">{PRESETS.map(x => <button key={x.k} className={`btn small${preset === x.k ? ' primary' : ''}`} aria-pressed={preset === x.k} onClick={() => setPreset(x.k)}>{x.l}</button>)}</div>

      <section className="card col">
        <h3>Metrics for {periodText}</h3>
        <div className="metrics wide">
          <Metric label="Total recorded cash" value={inr(m.totalRecordedCash)} note="Every category, as actually paid" />
          <Metric label="Maintenance + repair" value={inr(m.maintenanceAndRepair)} note="Service bills, repairs, tyres, consumables" />
          <Metric label="Fuel cost / km" na={m.fuelCostPerKm === undefined} value={m.fuelCostPerKm === undefined ? 'Not enough data' : inr(m.fuelCostPerKm, 2)} note="Full-to-full periods ending in the period" />
          <Metric label="Operating cost / km" na={m.operatingCostPerKm === undefined} value={m.operatingCostPerKm === undefined ? 'Not enough data' : inr(m.operatingCostPerKm, 2)} note={m.kmInPeriod ? `Chosen categories ÷ ${num(m.kmInPeriod)} km` : undefined} />
        </div>
        {m.notes.map(n => <p className="small muted" key={n}>{n}</p>)}
        <details><summary className="small" style={{ cursor: 'pointer' }}>How these are calculated · choose categories for operating cost</summary>
          <div className="col small muted" style={{ marginTop: '.5rem' }}>
            <p><strong>Total recorded cash</strong> adds every fuel, service and expense entry dated in the period. No allocation, no estimates.</p>
            <p><strong>Fuel cost per km</strong> = fuel or charging spend ÷ distance, using only full-tank-to-full-tank periods.</p>
            <p><strong>Operating cost per km</strong> = spend in the categories ticked below ÷ distance between the first and last odometer readings in the period. Insurance and registration are left out by default because they are annual costs, not cost of riding; tick them to include.</p>
            <div className="row wrap" style={{ gap: '.4rem' }}>{ALL.map(c => <label key={c} className="check" style={{ minWidth: 150 }}><input type="checkbox" checked={cats.includes(c)} onChange={() => setCats(toggle(cats, c))} />{LABEL(c)}</label>)}</div>
          </div>
        </details>
      </section>

      {byCat.length > 0 && (
        <section className="card col">
          <h3>Where the money went ({periodText})</h3>
          <div role="img" aria-label="Bar chart of spend by category" style={{ height: 240 }}>
            <ResponsiveContainer><BarChart data={byCat} layout="vertical" margin={{ left: 30, right: 12 }}><CartesianGrid stroke="var(--line)" horizontal={false} /><XAxis type="number" stroke="var(--faint)" fontSize={11} /><YAxis type="category" dataKey="label" stroke="var(--muted)" fontSize={12} width={96} /><Tooltip contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)' }} formatter={(v) => [inr(Number(v)), 'Spent']} /><Bar dataKey="amount" fill="var(--accent)" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="card col">
        <h3>Ownership-cost estimate (optional)</h3>
        <Notice kind="info">A broader estimate: the recorded costs you tick, plus <strong>depreciation</strong> (purchase price minus <em>your own</em> resale estimate). It is an estimate built from your assumptions, not a valuation. Monthly cash payments and a purchase price are never mixed.</Notice>
        {!b.vehicle.purchaseDate ? <p className="muted small">Add a purchase date on the Specs tab to use this.</p> : (
          <>
            <div className="row wrap" style={{ gap: '.4rem' }}>{ALL.map(c => <label key={c} className="check" style={{ minWidth: 150 }}><input type="checkbox" checked={include.includes(c)} onChange={() => setInclude(toggle(include, c))} />{LABEL(c)}</label>)}</div>
            {est && <div className="metrics wide"><Metric label="Recorded costs" value={inr(est.cash)} note={`${est.months} months owned`} /><Metric label="Depreciation (assumed)" na={est.depreciation === undefined} value={est.depreciation === undefined ? 'Not set' : inr(est.depreciation)} /><Metric label="Estimated total" value={inr(est.total)} /><Metric label="Per month" value={inr(est.perMonth)} /></div>}
            {est?.assumptions.map(a => <p className="small muted" key={a}>{a}</p>)}
          </>
        )}
      </section>

      <section className="card col">
        <h3>Other expenses</h3>
        {b.expenses.length === 0 ? <Empty title="No expenses yet">Insurance, tyres, repairs, parking, tolls and more go here.</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th className="num">Amount</th><th /></tr></thead><tbody>
            {[...b.expenses].sort((x, y) => y.date.localeCompare(x.date)).map(x => (
              <tr key={x.id}><td>{fmtDate(x.date)}</td><td>{EXPENSE_LABEL[x.category]}<div className="small muted">{x.notes}</div></td><td className="num">{inr(x.amount)}</td>
                <td className="num no-print" style={{ whiteSpace: 'nowrap' }}><button className="btn small ghost" onClick={() => setEdit(x)}>Edit</button><button className="btn small ghost danger" onClick={() => setDel(x)}>Delete</button></td></tr>
            ))}
          </tbody></table></div>
        )}
      </section>

      {edit && <ExpenseForm bundle={b} entry={edit} onClose={() => setEdit(undefined)} />}
      <Confirm open={!!del} title="Delete this expense?" onCancel={() => setDel(undefined)}
        onConfirm={async () => { if (del) await softDelete('expenses', del.id); setDel(undefined); bump(); toast('Expense deleted. Restore it from Backup & restore.'); }}
        body={<p>{del && `${fmtDate(del.date)} · ${EXPENSE_LABEL[del.category]} · ${inr(del.amount)}`}</p>} />
      <span hidden><Field label=""><span /></Field></span>
    </div>
  );
}


function LoanCard({ loan, onLogged }: { vehicleId: string; loan: Loan; onLogged: (through: number) => Promise<void> }) {
  const due = instalmentsDue(loan.firstEmiDate, todayIso(), loan.tenureMonths);
  const rows = useMemo(() => schedule(loan.method, loan.principal, loan.ratePct, loan.tenureMonths), [loan]);
  const left = due === 0 ? loan.principal : rows[due - 1].balance;
  const logged = loan.interestLoggedThrough ?? 0;
  const pending = due - logged;
  const nextDate = due < loan.tenureMonths ? emiDate(loan.firstEmiDate, due) : undefined;
  return (
    <section className="card col">
      <h3>Loan{loan.lender ? ` · ${loan.lender}` : ''}</h3>
      <div className="metrics wide">
        <Metric label="EMI" value={inr(loan.emi)} note={`${loan.tenureMonths} months at ${loan.ratePct}% (${loan.method === 'flat' ? 'flat' : 'reducing'})`} />
        <Metric label="EMIs due so far" value={`${due} of ${loan.tenureMonths}`} note={nextDate ? `Next: ${fmtDate(nextDate)}` : 'All instalments are due'} />
        <Metric label="Principal left (estimate)" value={inr(left)} note="From the schedule, assuming every EMI was paid" />
      </div>
      <p className="small muted">Only the interest part of an EMI is a running cost; the principal repays the purchase price. Record the interest here and it appears in your expenses as "Loan interest".</p>
      <div><button className="btn" disabled={pending <= 0} onClick={() => void onLogged(due)}>{pending > 0 ? `Record interest for ${pending} EMI${pending === 1 ? '' : 's'}` : 'Interest is up to date'}</button></div>
    </section>
  );
}
