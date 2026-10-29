import { useMemo, useState } from 'react';
import { buildLedger, filterLedger, fuelSummary } from '../../domain/calc';
import { SPEC_KEYS, SPEC_LABEL } from '../../domain/types';
import { efficiencyUnit } from '../../lib/vehicle';
import { effectiveSpecs } from '../../lib/vehicle';
import { fmtDate, inr, km, num, specText, vehicleTitle } from '../../lib/format';
import { Notice } from '../components/kit';
import type { VCtx } from './VehicleLayout';

export default function Report({ bundle: b }: VCtx) {
  const v = b.vehicle;
  const [o, setO] = useState({ specs: true, services: true, odo: true, fuel: true, costs: false, registration: false, workshop: true, notes: false });
  const set = (k: keyof typeof o) => (e: React.ChangeEvent<HTMLInputElement>) => setO(s => ({ ...s, [k]: e.target.checked }));
  const fs = useMemo(() => fuelSummary(b.fuel), [b.fuel]);
  const ledger = useMemo(() => buildLedger(b.fuel, b.services, b.expenses), [b]);
  const specs = effectiveSpecs(v);
  const total = filterLedger(ledger, {}).reduce((a, i) => a + i.amount, 0);
  const history = [...b.services].sort((a, c) => a.date.localeCompare(c.date));

  return (
    <div className="stack-lg">
      <section className="card col no-print">
        <h2>Ownership report</h2>
        <p className="muted small">Choose exactly what to include, then print or save as PDF from your browser. Nothing is shared automatically.</p>
        <div className="grid auto" style={{ gap: '.4rem' }}>
          {([['specs', 'Specifications'], ['services', 'Maintenance timeline & parts'], ['odo', 'Odometer records'], ['fuel', 'Fuel records and efficiency'], ['costs', 'Costs and amounts paid'], ['workshop', 'Workshop names'], ['notes', 'My notes'], ['registration', 'Registration number']] as const).map(([k, l]) => (
            <label className="check" key={k}><input type="checkbox" checked={o[k]} onChange={set(k)} />{l}</label>
          ))}
        </div>
        <div><button className="btn primary" onClick={() => window.print()}>Print / save as PDF</button></div>
        <Notice kind="info">Personal contact details are never included. Financial figures and the registration number are off by default.</Notice>
      </section>

      <article className="card col" aria-label="Report preview">
        <div>
          <p className="label">RideRecord · owner-maintained history</p>
          <h1>{vehicleTitle(v)}</h1>
          <p className="muted">{v.manufacturer} {v.model}{v.variant ? ` ${v.variant}` : ''} · {v.year}{o.registration && v.registration ? ` · Reg. ${v.registration}` : ''}</p>
          <p className="small muted">Generated {fmtDate(new Date().toISOString())}. {b.lastOdo ? `Last recorded odometer ${km(b.lastOdo.km)} on ${fmtDate(b.lastOdo.date)}.` : ''}</p>
        </div>
        <Notice kind="warn"><strong>This is a user-maintained record.</strong> It was compiled by the owner from their own entries. It is not a mechanical inspection, a valuation, or an official certification, and its accuracy has not been independently verified.</Notice>

        {o.specs && (
          <section><h2>Specifications</h2>
            {SPEC_KEYS.filter(k => specs[k]).length === 0 ? <p className="muted small">No specifications recorded.</p> : SPEC_KEYS.filter(k => specs[k]).map(k => <div className="spec-row" key={k}><span>{SPEC_LABEL[k]}</span><span>{specText(k, specs[k]!).main} <span className="small muted">({specs[k]!.verification === 'user-entered' ? 'owner-entered' : specs[k]!.verification === 'verified' ? 'sourced' : 'unverified'})</span></span></div>)}
          </section>
        )}

        {o.services && (
          <section><h2>Maintenance timeline</h2>
            {history.length === 0 ? <p className="muted small">No services recorded.</p> : (
              <div className="table-wrap"><table><thead><tr><th>Date</th><th className="num">Odometer</th>{o.workshop && <th>Workshop</th>}<th>Work and parts</th>{o.costs && <th className="num">Cost</th>}</tr></thead><tbody>
                {history.map(s => <tr key={s.id}><td>{fmtDate(s.date)}</td><td className="num">{s.odometer !== undefined ? num(s.odometer) : '—'}</td>{o.workshop && <td>{s.workshop ?? '—'}</td>}<td>{s.work}{s.parts ? ` · Parts: ${s.parts}` : ''}{o.notes && s.notes ? ` · ${s.notes}` : ''}</td>{o.costs && <td className="num">{inr(s.labourCost + s.partsCost)}</td>}</tr>)}
              </tbody></table></div>
            )}
          </section>
        )}

        {o.odo && (
          <section><h2>Mileage records</h2>
            {b.readings.length === 0 ? <p className="muted small">No readings recorded.</p> : (
              <div className="table-wrap"><table><thead><tr><th>Date</th><th className="num">Odometer</th><th>Recorded from</th></tr></thead><tbody>
                {b.readings.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td className="num">{num(r.km)} km</td><td>{r.source === 'purchase' ? 'Purchase' : r.source}</td></tr>)}
              </tbody></table></div>
            )}
          </section>
        )}

        {o.fuel && (
          <section><h2>Fuel summary</h2>
            {fs.latest ? <p>{fs.segments.length} measured full-to-full periods. Lifetime average <strong>{num(fs.lifetimeKmPerUnit, 1)} {efficiencyUnit(v)}</strong> (owner-recorded).{o.costs && ` Total fuel spend ${inr(fs.totalSpend)}.`}</p> : <p className="muted small">{fs.insufficientReason}</p>}
          </section>
        )}
        {o.costs && <section><h2>Total recorded spend</h2><p><strong>{inr(total)}</strong> across fuel, service and other expenses.</p></section>}
        <p className="small faint">Receipts and invoices referenced here are held by the owner and available on request.</p>
      </article>
    </div>
  );
}
