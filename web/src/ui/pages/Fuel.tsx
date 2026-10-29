import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { softDelete } from '../../db/repo';
import { comparePeriods, fuelSummary, spendByMonth, spendByYear, todayIso } from '../../domain/calc';
import type { FuelEntry } from '../../domain/types';
import { efficiencyUnit, quantityUnit } from '../../lib/vehicle';
import { fmtDate, fmtMonth, inr, num, pct } from '../../lib/format';
import { useApp } from '../../lib/store';
import { Confirm, Empty, Icon, Metric, Notice } from '../components/kit';
import { FuelForm } from '../components/forms';
import type { VCtx } from './VehicleLayout';

const axis = { stroke: 'var(--faint)', fontSize: 11 };
const tip = { contentStyle: { background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)' }, labelStyle: { color: 'var(--muted)' } };

export default function Fuel({ bundle: b, open }: VCtx) {
  const { bump, toast } = useApp();
  const ev = b.vehicle.fuelType === 'electric';
  const unit = quantityUnit(b.vehicle), eu = efficiencyUnit(b.vehicle);
  const fs = fuelSummary(b.fuel);
  const cmp = comparePeriods(b.fuel, todayIso(), 90);
  const [edit, setEdit] = useState<FuelEntry>();
  const [del, setDel] = useState<FuelEntry>();
  const months = spendByMonth(b.fuel);
  const years = spendByYear(b.fuel);
  const effData = fs.segments.map(s => ({ date: s.toDate, eff: Number(s.kmPerUnit.toFixed(2)), label: fmtDate(s.toDate) }));
  const rows = [...b.fuel].sort((a, c) => c.date.localeCompare(a.date) || c.odometer - a.odometer);
  const segByTo = new Map(fs.segments.map(s => [s.toId, s]));
  const unitPrices = b.fuel.filter(f => f.quantity > 0 && f.total > 0).map(f => f.total / f.quantity);

  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div><h2>{ev ? 'Charging log' : 'Fuel log'}</h2><p className="muted small">Real figures from your own entries, not the manufacturer's claim.</p></div>
        <button className="btn primary no-print" onClick={() => open('fuel')}><Icon name={ev ? 'bolt' : 'fuel'} />{ev ? 'Log charging session' : 'Log fuel'}</button>
      </div>

      <Notice kind="info"><strong>How efficiency is measured.</strong> Efficiency is calculated between two consecutive <em>full</em> {ev ? 'charges' : 'tank fills'}: distance travelled ÷ {ev ? 'energy' : 'fuel'} added since the earlier full fill (partial top-ups in between are included). Single partial refills can't give a dependable number, so they are not used on their own.</Notice>

      <div className="metrics wide">
        <Metric label="Latest efficiency" na={!fs.latest} value={fs.latest ? num(fs.latest.kmPerUnit, 1) : 'Not enough data'} unit={eu} note={fs.latest ? `${num(fs.latest.unitPer100km, 2)} ${unit}/100 km` : fs.insufficientReason} />
        <Metric label="Lifetime average" na={fs.lifetimeKmPerUnit === undefined} value={fs.lifetimeKmPerUnit ? num(fs.lifetimeKmPerUnit, 1) : 'Not enough data'} unit={eu} note={`${fs.segments.length} measured period${fs.segments.length === 1 ? '' : 's'}`} />
        <Metric label={`Cost per km`} na={fs.costPerKm === undefined} value={fs.costPerKm === undefined ? 'Not enough data' : inr(fs.costPerKm, 2)} note="Full-to-full periods only" />
        <Metric label={`Avg price per ${unit}`} na={fs.avgPricePerUnit === undefined} value={fs.avgPricePerUnit === undefined ? 'Not enough data' : inr(fs.avgPricePerUnit, 2)} note={unitPrices.length > 1 ? `Range ${inr(Math.min(...unitPrices), 1)}–${inr(Math.max(...unitPrices), 1)}` : undefined} />
        <Metric label="Last 90 days" value={inr(cmp.currentSpend)} note={cmp.spendChangePct !== undefined ? `${pct(cmp.spendChangePct)} vs previous 90 days (${inr(cmp.previousSpend)})` : 'No earlier period to compare'} />
        <Metric label="Total spent" value={inr(fs.totalSpend)} note={`${num(fs.totalQuantity, 1)} ${unit} in ${fs.entryCount} entries`} />
      </div>

      {b.fuel.length === 0 ? (
        <div className="card"><Empty title={ev ? 'No charging sessions yet' : 'No fuel entries yet'} action={<button className="btn primary" onClick={() => open('fuel')}>{ev ? 'Log first charge' : 'Log first fill'}</button>}>Fill up to full, note the odometer, and log it. Two full fills give your first real-world efficiency number.</Empty></div>
      ) : (
        <div className="grid cols-2">
          <section className="card col">
            <h3>Efficiency trend ({eu})</h3>
            {effData.length < 2 ? <p className="muted small">A trend appears after two measured periods ({effData.length} so far).</p> : (
              <div role="img" aria-label={`Line chart of efficiency in ${eu} across ${effData.length} measured periods`} style={{ height: 220 }}>
                <ResponsiveContainer><LineChart data={effData} margin={{ left: -10, right: 8, top: 8 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} domain={['auto', 'auto']} /><Tooltip {...tip} formatter={(v) => [`${v} ${eu}`, 'Efficiency']} /><Line type="monotone" dataKey="eff" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer>
              </div>
            )}
          </section>
          <section className="card col">
            <h3>Monthly spend (₹)</h3>
            <div role="img" aria-label="Bar chart of monthly spend" style={{ height: 220 }}>
              <ResponsiveContainer><BarChart data={months.map(m => ({ ...m, label: fmtMonth(m.month) }))} margin={{ left: -10, right: 8, top: 8 }}><CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} /><Tooltip {...tip} formatter={(v) => [inr(Number(v)), 'Spent']} /><Bar dataKey="spend" fill="var(--accent)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
            </div>
            {years.length > 0 && <p className="small muted">By year: {years.map(y => `${y.year} ${inr(y.spend)}`).join(' · ')}</p>}
          </section>
        </div>
      )}

      {rows.length > 0 && (
        <section className="card">
          <h3 style={{ marginBottom: '.5rem' }}>All entries</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th className="num">Odometer</th><th className="num">{unit}</th><th className="num">Total</th><th className="num">{eu}</th><th /></tr></thead>
            <tbody>{rows.map(f => {
              const seg = segByTo.get(f.id);
              return (
                <tr key={f.id}>
                  <td>{fmtDate(f.date)}<div className="small muted">{f.station}</div></td>
                  <td className="num">{num(f.odometer)}</td>
                  <td className="num">{num(f.quantity, 2)}{!f.fullTank && <div className="small muted">partial</div>}</td>
                  <td className="num">{inr(f.total)}</td>
                  <td className="num">{seg ? num(seg.kmPerUnit, 1) : <span className="faint" title={f.skippedPrevious ? 'Earlier fill not logged' : !f.fullTank ? 'Partial fill' : 'Needs an earlier full fill'}>—</span>}</td>
                  <td className="num no-print" style={{ whiteSpace: 'nowrap' }}><button className="btn small ghost" onClick={() => setEdit(f)} aria-label={`Edit entry ${f.date}`}>Edit</button><button className="btn small ghost danger" onClick={() => setDel(f)} aria-label={`Delete entry ${f.date}`}>Delete</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>
      )}

      {edit && <FuelForm bundle={b} entry={edit} onClose={() => setEdit(undefined)} />}
      <Confirm open={!!del} title="Delete this entry?" onCancel={() => setDel(undefined)}
        onConfirm={async () => { if (del) await softDelete('fuel', del.id); setDel(undefined); bump(); toast('Entry deleted. Restore it from Backup & restore → Recently deleted.'); }}
        body={<p>{del && `${fmtDate(del.date)} · ${num(del.quantity, 2)} ${unit} · ${inr(del.total)}`}<br /><span className="muted small">Efficiency figures will be recalculated without it. You can restore it later.</span></p>} />
    </div>
  );
}
