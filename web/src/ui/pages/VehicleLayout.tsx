import { lazy, Suspense, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { listVehicles, type VehicleBundle } from '../../db/repo';
import { RemoveVehicleDialog } from '../components/RemoveVehicle';
import { Empty, ErrorBox, VehicleImage, Icon, Loading, Odometer } from '../components/kit';
import { ExpenseForm, FuelForm, OdometerForm, ServiceForm } from '../components/forms';
import { useApp, useAsync, useBundle } from '../../lib/store';
import { vehicleSubtitle, vehicleTitle, km } from '../../lib/format';
import Overview from './Overview';

const Fuel = lazy(() => import('./Fuel'));
const Money = lazy(() => import('./Money'));
const Service = lazy(() => import('./Service'));
const Docs = lazy(() => import('./Docs'));
const Specs = lazy(() => import('./Specs'));
const Report = lazy(() => import('./Report'));

export type Dialog = null | 'fuel' | 'expense' | 'odometer' | 'service';
export interface VCtx { bundle: VehicleBundle; open: (d: Dialog) => void }

const SECTIONS = [
  { to: '', label: 'Overview', icon: 'gauge', end: true },
  { to: 'fuel', label: 'Fuel', icon: 'fuel' },
  { to: 'service', label: 'Service', icon: 'wrench' },
  { to: 'money', label: 'Costs', icon: 'wallet' },
  { to: 'docs', label: 'Docs', icon: 'file' },
  { to: 'specs', label: 'Specs', icon: 'list' },
  { to: 'report', label: 'Report', icon: 'shield' },
] as const;

export default function VehicleLayout() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { bump, toast } = useApp();
  const state = useBundle(id);
  const all = useAsync(() => listVehicles(), []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (state.loading) return <main className="page"><Loading label="Opening vehicle" /></main>;
  if (state.error) return <main className="page"><ErrorBox error={state.error} /></main>;
  const b = state.data;
  if (!b) return <main className="page"><Empty title="Vehicle not found" action={<Link className="btn" to="/">Back to garage</Link>}>It may have been deleted. Deleted vehicles can be restored from Backup &amp; restore.</Empty></main>;

  const section = loc.pathname.split('/')[3] ?? '';
  const open = (d: Dialog) => setDialog(d);
  const close = () => setDialog(null);
  const ctx: VCtx = { bundle: b, open };
  const others = (all.data ?? []);

  return (
    <main className="page">
      <div className="row wrap vhead" style={{ marginBottom: '.9rem' }}>
        <VehicleImage vehicle={b.vehicle} className="glyph big" />
        <div className="grow">
          <h1>{vehicleTitle(b.vehicle)}</h1>
          <p className="muted small">{vehicleSubtitle(b.vehicle)}</p>
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: '.35rem' }}>
          <Odometer value={b.lastOdo?.km} />
          <span className="small muted">{b.lastOdo ? `${km(b.lastOdo.km)} last known` : 'No odometer reading yet'}</span>
        </div>
      </div>

      {others.length > 1 && (
        <div className="row no-print" style={{ marginBottom: '.5rem' }}>
          <label className="row small muted" style={{ gap: '.5rem' }}>
            Switch vehicle
            <select value={b.vehicle.id} onChange={e => nav(`/v/${e.target.value}${section ? '/' + section : ''}`)} style={{ width: 'auto', minHeight: 36 }} aria-label="Switch vehicle">
              {others.map(v => <option key={v.id} value={v.id}>{vehicleTitle(v)}</option>)}
            </select>
          </label>
        </div>
      )}

      <nav className="tabs no-print" aria-label="Vehicle sections">
        {SECTIONS.map(s => <NavLink key={s.to} to={`/v/${b.vehicle.id}${s.to ? '/' + s.to : ''}`} end={'end' in s && s.end}>{s.label}</NavLink>)}
      </nav>

      <Suspense fallback={<Loading />}>
        <div className="tab-body" key={loc.pathname}><Routes>
          <Route index element={<Overview {...ctx} />} />
          <Route path="fuel" element={<Fuel {...ctx} />} />
          <Route path="service" element={<Service {...ctx} />} />
          <Route path="money" element={<Money {...ctx} />} />
          <Route path="docs" element={<Docs {...ctx} />} />
          <Route path="specs" element={<Specs {...ctx} onDelete={() => setConfirmDelete(true)} />} />
          <Route path="report" element={<Report {...ctx} />} />
          <Route path="*" element={<Empty title="Section not found" />} />
        </Routes></div>
      </Suspense>

      <nav className="bottom-nav no-print" aria-label="Vehicle sections (mobile)">
        {SECTIONS.filter(s => ['', 'fuel', 'service', 'money', 'docs'].includes(s.to)).map(s => (
          <NavLink key={s.to} to={`/v/${b.vehicle.id}${s.to ? '/' + s.to : ''}`} end={'end' in s && s.end}><Icon name={s.icon} />{s.label}</NavLink>
        ))}
        <NavLink to={`/v/${b.vehicle.id}/specs`}><Icon name="cog" />More</NavLink>
      </nav>

      {dialog === 'fuel' && <FuelForm bundle={b} onClose={close} />}
      {dialog === 'expense' && <ExpenseForm bundle={b} onClose={close} />}
      {dialog === 'odometer' && <OdometerForm bundle={b} onClose={close} />}
      {dialog === 'service' && <ServiceForm bundle={b} onClose={close} />}

      <RemoveVehicleDialog vehicle={b.vehicle} open={confirmDelete} onClose={() => setConfirmDelete(false)} onDone={() => { setConfirmDelete(false); bump(); toast('Vehicle removed. You can restore it from Backup → Recently deleted.'); nav('/'); }} />
    </main>
  );
}
