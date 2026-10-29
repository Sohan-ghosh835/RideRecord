import { Link } from 'react-router-dom';
import { comparePeriods, todayIso } from '../../domain/calc';
import { expiryStatus } from '../../domain/maintenance';
import { DOC_LABEL } from '../../domain/types';
import { efficiencyUnit, quantityUnit } from '../../lib/vehicle';
import { fmtDate, inr, km, num, pct } from '../../lib/format';
import { DueChip, Chip, Empty, Icon, Metric, Notice } from '../components/kit';
import { summarize } from './Garage';
import type { VCtx } from './VehicleLayout';

export default function Overview({ bundle: b, open }: VCtx) {
  const { fs, dueRows, docs } = summarize(b);
  const eu = efficiencyUnit(b.vehicle);
  const ev = b.vehicle.fuelType === 'electric';
  const cmp = comparePeriods(b.fuel, todayIso(), 90);
  const attention = dueRows.filter(r => r.due.status === 'due' || r.due.status === 'overdue' || r.due.status === 'soon');
  const needsStart = dueRows.filter(r => r.due.status === 'unknown').length;
  const recent = [
    ...b.fuel.map(f => ({ date: f.date, t: `${f.kind === 'fuel' ? 'Fuel' : 'Charge'} · ${num(f.quantity, 1)} ${quantityUnit(b.vehicle)}`, s: inr(f.total), at: f.createdAt })),
    ...b.services.map(s => ({ date: s.date, t: `Service · ${s.work.slice(0, 48)}`, s: inr(s.labourCost + s.partsCost), at: s.createdAt })),
    ...b.expenses.map(x => ({ date: x.date, t: `Expense · ${x.category}`, s: inr(x.amount), at: x.createdAt })),
  ].sort((a, c) => c.date.localeCompare(a.date) || c.at.localeCompare(a.at)).slice(0, 6);
  const empty = b.fuel.length + b.services.length + b.expenses.length === 0;

  return (
    <div className="stack-lg">
      <div className="quick no-print" role="group" aria-label="Quick actions">
        <button className="btn" onClick={() => open('fuel')}><Icon name={ev ? 'bolt' : 'fuel'} />{ev ? 'Log charge' : 'Add fuel'}</button>
        <button className="btn" onClick={() => open('expense')}><Icon name="wallet" />Expense</button>
        <button className="btn" onClick={() => open('odometer')}><Icon name="gauge" />Odometer</button>
        <button className="btn" onClick={() => open('service')}><Icon name="wrench" />Log service</button>
      </div>

      {b.lastOdo === undefined && <Notice kind="info"><strong>No odometer reading yet.</strong> Add one so distance-based service reminders can work. <button className="btn small" onClick={() => open('odometer')}>Add reading</button></Notice>}

      <div className="grid cols-2 lg-main">
        <section className="card col">
          <h2>Needs attention</h2>
          {attention.length === 0 ? (
            <p className="muted">{dueRows.length === 0 ? 'No maintenance rules set up for this vehicle.' : needsStart === dueRows.length ? 'Tell RideRecord when things were last done so it can start counting.' : 'Nothing is due right now.'}</p>
          ) : (
            <div className="list">
              {attention.slice(0, 5).map(r => (
                <div className="li" key={r.task.id}><div className="grow"><div className="t">{r.task.name}</div><div className="s">{r.due.message}</div></div><DueChip status={r.due.status} /></div>
              ))}
            </div>
          )}
          {needsStart > 0 && needsStart < dueRows.length && <p className="small muted">{needsStart} task{needsStart > 1 ? 's need' : ' needs'} a starting point.</p>}
          <Link to="service" className="btn small" style={{ alignSelf: 'flex-start' }}>Open service plan</Link>
        </section>

        <section className="card col">
          <h2>Documents</h2>
          {docs.length === 0 ? <p className="muted">{b.documents.some(d => d.expiry) ? 'No document expires soon.' : 'Store insurance, registration and PUC with expiry dates to get reminders.'}</p> : (
            <div className="list">{docs.map(({ d, s }) => <div className="li" key={d.id}><div className="grow"><div className="t">{d.title}</div><div className="s">{DOC_LABEL[d.type]} · {s === 'expired' ? 'expired' : 'expires'} {fmtDate(d.expiry)}</div></div><Chip kind={s === 'expired' ? 'expired' : 'soon'}>{s === 'expired' ? 'Expired' : 'Expiring'}</Chip></div>)}</div>
          )}
          <Link to="docs" className="btn small" style={{ alignSelf: 'flex-start' }}>Open document wallet</Link>
        </section>
      </div>

      <section className="card col">
        <div className="row between"><h2>Real-world efficiency</h2><Link to="fuel" className="small">Details →</Link></div>
        {fs.latest ? (
          <div className="metrics wide">
            <Metric label="Latest" value={num(fs.latest.kmPerUnit, 1)} unit={eu} note={`${num(fs.latest.distance)} km between full fills`} />
            <Metric label="Recent (last 3)" value={num(fs.recentAvgKmPerUnit, 1)} unit={eu} note={cmp.efficiencyChangePct !== undefined ? `${pct(cmp.efficiencyChangePct)} vs previous 90 days` : undefined} />
            <Metric label={ev ? 'Charging cost / km' : 'Fuel cost / km'} value={inr(fs.costPerKm, 2)} note="Full-to-full fills only" />
            <Metric label="Total recorded" value={inr(fs.totalSpend)} note={`${fs.entryCount} entries`} />
          </div>
        ) : <Notice kind="info">{fs.insufficientReason ?? 'Log fills to see efficiency.'} <button className="btn small" onClick={() => open('fuel')}>{ev ? 'Log a charge' : 'Add fuel'}</button></Notice>}
      </section>

      <section className="card col">
        <h2>Recent activity</h2>
        {empty ? <Empty title="Nothing recorded yet">Your first fill, service or expense will show up here.</Empty> : (
          <div className="list">{recent.map((r, i) => <div className="li" key={i}><div className="grow"><div className="t">{r.t}</div><div className="s">{fmtDate(r.date)}</div></div><span>{r.s}</span></div>)}</div>
        )}
        {b.lastOdo && <p className="small faint">Last known odometer {km(b.lastOdo.km)} on {fmtDate(b.lastOdo.date)} (from {b.lastOdo.source === 'purchase' ? 'purchase record' : b.lastOdo.source}).</p>}
      </section>
      <p className="small faint">Manufacturer-published figures are shown separately on the Specs tab and are never used as your real-world numbers.</p>
      {expiryStatus(undefined, 0) === 'none' && null}
    </div>
  );
}
