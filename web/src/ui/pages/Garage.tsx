import { Link } from 'react-router-dom';
import { listVehicles, loadBundle, getMeta, type VehicleBundle } from '../../db/repo';
import { fuelSummary } from '../../domain/calc';
import { computeDue, expiryStatus, sortByUrgency } from '../../domain/maintenance';
import { efficiencyUnit } from '../../lib/vehicle';
import { inr, km, num, vehicleSubtitle, vehicleTitle } from '../../lib/format';
import { useApp, useAsync } from '../../lib/store';
import { getDemoIds, loadDemo, removeDemo } from '../../lib/demo';
import { RemoveVehicleDialog } from '../components/RemoveVehicle';
import { useState } from 'react';
import type { Vehicle } from '../../domain/types';
import { Chip, DueChip, Empty, ErrorBox, VehicleImage, Icon, Loading, Metric, Notice, Odometer } from '../components/kit';

export function summarize(b: VehicleBundle) {
  const fs = fuelSummary(b.fuel);
  const dueRows = sortByUrgency(b.tasks.filter(t => t.enabled).map(task => ({ task, due: computeDue(task, b.services, b.lastOdo?.km) })));
  const docs = b.documents.filter(d => d.type !== 'receipt').map(d => ({ d, s: expiryStatus(d.expiry, d.reminderDays) })).filter(x => x.s === 'soon' || x.s === 'expired');
  return { fs, dueRows, docs };
}

export default function Garage() {
  const { bump, toast } = useApp();
  const [removing, setRemoving] = useState<Vehicle | undefined>();
  const state = useAsync(async () => {
    const vs = await listVehicles();
    const bundles = (await Promise.all(vs.map(v => loadBundle(v.id)))).filter((b): b is VehicleBundle => !!b);
    const lastBackup = await getMeta<string>('lastBackupAt');
    return { bundles, lastBackup, demo: (await getDemoIds()).length > 0 };
  }, []);

  if (state.loading) return <main className="page"><Loading label="Opening your garage" /></main>;
  if (state.error || !state.data) return <main className="page"><ErrorBox error={state.error ?? 'Unknown error'} /></main>;
  const { bundles, lastBackup, demo } = state.data;

  const hasRecords = bundles.some(b => b.fuel.length + b.services.length + b.expenses.length > 0);
  const daysSince = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup)) / 86_400_000) : undefined;
  const needsBackup = hasRecords && (daysSince === undefined || daysSince > 30);

  return (
    <main className="page stack-lg">
      <div className="row between wrap">
        <div><h1>Your garage</h1><p className="muted">{bundles.length ? `${bundles.length} vehicle${bundles.length > 1 ? 's' : ''}, stored privately on this device.` : 'One place for every ride you own.'}</p></div>
        <div className="row wrap"><Link to="/add" className="btn primary"><Icon name="plus" /> Add a bike or scooter</Link><Link to="/buy" className="btn"><Icon name="wallet" /> Buying new? Plan the EMI</Link></div>
      </div>

      {demo && (
        <Notice kind="info">
          <strong>Sample data.</strong> The garage below is a demo with invented prices, distances and workshops so you can try every screen. <button className="btn small" onClick={async () => { await removeDemo(); bump(); toast('Demo data removed'); }}>Remove demo data</button>
        </Notice>
      )}

      {needsBackup && !demo && (
        <Notice kind="warn">
          <strong>{daysSince === undefined ? 'You have not backed up yet.' : `Your last backup was ${daysSince} days ago.`}</strong> Your records live only in this browser. <Link to="/settings">Export a backup</Link> so a cleared browser or lost phone cannot erase your history.
        </Notice>
      )}

      {bundles.length === 0 ? (
        <div className="card">
          <Empty title="Your garage is empty" action={<div className="row wrap" style={{ justifyContent: 'center' }}><Link to="/add" className="btn primary"><Icon name="search" /> Find my bike</Link><button className="btn" onClick={async () => { await loadDemo(); bump(); toast('Demo garage loaded'); }}>Try with sample data</button></div>}>
            Search for your exact motorcycle or scooter and RideRecord builds its ownership profile: specifications, maintenance schedule, fuel log, expenses and documents. Brand new, second-hand, or owned for years, you can start from wherever you are today.
          </Empty>
        </div>
      ) : (
        <div className="grid auto">
          {bundles.map(b => {
            const { fs, dueRows, docs } = summarize(b);
            const next = dueRows.find(r => r.due.status !== 'unknown' && r.due.status !== 'ok') ?? dueRows.find(r => r.due.status === 'ok');
            const eu = efficiencyUnit(b.vehicle);
            return (
              <div key={b.vehicle.id} className="vwrap">
              <Link to={`/v/${b.vehicle.id}`} className="card vcard col" aria-label={`Open ${vehicleTitle(b.vehicle)}`}>
                <div className="row vtop">
                  <VehicleImage vehicle={b.vehicle} />
                  <div className="grow"><h2>{vehicleTitle(b.vehicle)}</h2><p className="muted small">{vehicleSubtitle(b.vehicle)}</p></div>
                </div>
                <div className="row between"><Odometer value={b.lastOdo?.km} /><span className="muted small">{b.lastOdo ? 'km' : 'no reading yet'}</span></div>
                <div className="metrics">
                  <Metric label="Last efficiency" na={!fs.latest} value={fs.latest ? num(fs.latest.kmPerUnit, 1) : 'Not enough data'} unit={eu} />
                  <Metric label="Fuel cost / km" na={fs.costPerKm === undefined} value={fs.costPerKm === undefined ? 'Not enough data' : inr(fs.costPerKm, 2)} />
                </div>
                <div className="row wrap" style={{ gap: '.4rem' }}>
                  {next ? <><DueChip status={next.due.status} /><span className="small muted">{next.task.name}{next.due.message ? ` · ${next.due.message}` : ''}</span></> : <span className="small muted">No maintenance rules yet</span>}
                </div>
                {docs.length > 0 && <Chip kind={docs.some(x => x.s === 'expired') ? 'expired' : 'soon'}>{docs.length} document{docs.length > 1 ? 's' : ''} need attention</Chip>}
                {b.lastOdo && <span className="small faint">Last reading {km(b.lastOdo.km)}</span>}
              </Link>
              <button type="button" className="vclose" aria-label={`Remove ${vehicleTitle(b.vehicle)} from garage`} title="Remove from garage" onClick={() => setRemoving(b.vehicle)}><Icon name="x" size={16} /></button>
              </div>
            );
          })}
        </div>
      )}
      {removing && <RemoveVehicleDialog vehicle={removing} open onClose={() => setRemoving(undefined)} onDone={() => { toast(`${vehicleTitle(removing)} removed. You can restore it from Backup → Recently deleted.`); setRemoving(undefined); bump(); }} />}
    </main>
  );
}
