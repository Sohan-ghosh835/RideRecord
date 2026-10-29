import { useState } from 'react';
import { save } from '../../db/repo';
import { SPEC_KEYS, SPEC_LABEL, type SpecKey, type SpecValue, type Vehicle } from '../../domain/types';
import { fmtDate, specText } from '../../lib/format';
import { effectiveSpecs, maskReg } from '../../lib/vehicle';
import { useApp } from '../../lib/store';
import { ColourPicker, Chip, Field, Notice, VehicleImage } from '../components/kit';
import { resizeToDataUrl } from '../../lib/photo';
import { catalogPhoto } from '../../lib/catalogPhotos';
import type { VCtx } from './VehicleLayout';

const VLABEL: Record<SpecValue['verification'], string> = { verified: 'Verified', 'seed-unverified': 'Unverified', estimated: 'Estimated', 'user-entered': 'Entered by you' };
const UNITS: Partial<Record<SpecKey, string>> = { displacement: 'cc', power: 'bhp', torque: 'Nm', tank: 'L', battery: 'kWh', range: 'km', kerbWeight: 'kg', seatHeight: 'mm', wheelbase: 'mm', groundClearance: 'mm', claimedEfficiency: 'km/L', topSpeed: 'km/h' };
const TEXT_SPECS: SpecKey[] = ['frontTyre', 'rearTyre', 'brakes', 'abs', 'suspension', 'transmission', 'chargeTime', 'warranty'];

export default function Specs({ bundle: b, onDelete }: VCtx & { onDelete: () => void }) {
  const v = b.vehicle;
  const { bump, toast } = useApp();
  const specs = effectiveSpecs(v);
  const [key, setKey] = useState<SpecKey>('power');
  const [val, setVal] = useState('');
  const [unit, setUnit] = useState('');
  const [reveal, setReveal] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(v.purchaseDate ?? '');
  const [price, setPrice] = useState(v.purchasePrice !== undefined ? String(v.purchasePrice) : '');
  const [resale, setResale] = useState(v.resaleEstimate !== undefined ? String(v.resaleEstimate) : '');
  const [nick, setNick] = useState(v.nickname ?? '');
  const [reg, setReg] = useState(v.registration ?? '');
  const [msg, setMsg] = useState('');
  const [photoErr, setPhotoErr] = useState('');
  const setPhoto = async (f?: File) => {
    setPhotoErr('');
    if (!f) return;
    try { await upd({ photo: await resizeToDataUrl(f) }); } catch (e) { setPhotoErr(e instanceof Error ? e.message : String(e)); }
  };

  const upd = async (patch: Partial<Vehicle>) => { await save('vehicles', { ...v, ...patch }); bump(); toast('Saved'); };
  const addOverride = async () => {
    const t = val.trim();
    if (!t) { setMsg('Enter a value.'); return; }
    const isText = TEXT_SPECS.includes(key);
    const n = Number(t);
    if (!isText && !Number.isFinite(n)) { setMsg('This figure must be a number.'); return; }
    setMsg('');
    await upd({ specOverrides: { ...v.specOverrides, [key]: { value: isText ? t : n, unit: isText ? undefined : unit || UNITS[key], verification: 'user-entered' } } });
    setVal('');
  };
  const removeOverride = async (k: SpecKey) => { const o = { ...v.specOverrides }; delete o[k]; await upd({ specOverrides: o }); };

  const present = SPEC_KEYS.filter(k => specs[k]);
  return (
    <div className="stack-lg">
      <section className="card col">
        <h2>Specifications</h2>
        <p className="muted small">Figures as published by the source shown. They describe the model, not your individual bike, and are never used as your real-world mileage.</p>
        {present.length === 0 ? <Notice kind="info">No specifications are stored for this vehicle. Add figures from your owner's manual below. They'll be labelled as entered by you.</Notice> : (
          <div>{present.map(k => {
            const s = specs[k]!; const t = specText(k, s); const mine = !!v.specOverrides[k];
            const src = s.sourceIndex !== undefined ? v.sources[s.sourceIndex] : undefined;
            return (
              <div className="spec-row" key={k}>
                <div><div>{SPEC_LABEL[k]}</div>{src && <div className="small faint">{src.label}{src.retrieved ? ` · ${src.retrieved}` : ''}</div>}</div>
                <div className="row" style={{ gap: '.5rem' }}>
                  <div style={{ textAlign: 'right' }}>{t.main}{t.conversion && <div className="small muted">{t.conversion}</div>}</div>
                  <Chip kind={s.verification}>{VLABEL[s.verification]}</Chip>
                  {mine && <button className="btn small ghost" onClick={() => removeOverride(k)} aria-label={`Remove your ${SPEC_LABEL[k]} correction`}>Undo</button>}
                </div>
              </div>
            );
          })}</div>
        )}
        <details><summary className="small" style={{ cursor: 'pointer' }}>Add or correct a figure (kept on your profile only)</summary>
          <div className="form-grid" style={{ marginTop: '.6rem' }}>
            <Field label="Specification"><select value={key} onChange={e => { setKey(e.target.value as SpecKey); setUnit(''); }}>{SPEC_KEYS.map(k => <option key={k} value={k}>{SPEC_LABEL[k]}</option>)}</select></Field>
            <Field label="Value"><input value={val} onChange={e => setVal(e.target.value)} maxLength={80} /></Field>
            {!TEXT_SPECS.includes(key) && <Field label="Unit"><input value={unit} onChange={e => setUnit(e.target.value)} placeholder={UNITS[key] ?? ''} maxLength={12} /></Field>}
            <div className="full row"><button className="btn" onClick={addOverride}>Save to my profile</button>{msg && <span className="small" style={{ color: 'var(--red)' }}>{msg}</span>}</div>
            <p className="small muted full">Corrections never change the shared catalog. They only affect this vehicle.</p>
          </div>
        </details>
        <details><summary className="small muted" style={{ cursor: 'pointer' }}>Sources</summary>
          <ul className="small muted">{v.sources.length ? v.sources.map((s, i) => <li key={i}>{s.label} ({s.kind}){s.url && <> · <a href={s.url} target="_blank" rel="noreferrer noopener">link</a></>}{s.retrieved && ` · retrieved ${s.retrieved}`}</li>) : <li>No source recorded.</li>}</ul>
          {v.catalogUpdatedAt && <p className="small faint">Catalog record last updated {fmtDate(v.catalogUpdatedAt)}. Your records are never overwritten when the catalog changes.</p>}
        </details>
      </section>

      <section className="card col">
        <h2>Photo</h2>
        <div className="row wrap">
          <VehicleImage vehicle={v} className="glyph big" />
          <div className="col grow" style={{ minWidth: 220 }}>
            <p className="muted small">Add a photo of your own bike. It is resized and kept on this device only, and included in your backups. Without one, the picture of your chosen colour from the catalog is shown.</p>
            <div className="row wrap">
              <label className="btn small" style={{ cursor: 'pointer' }}>{v.photo ? 'Replace photo' : 'Add photo'}<input type="file" accept="image/*" className="sr-only" onChange={e => { void setPhoto(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {v.photo && <button className="btn small ghost" onClick={() => upd({ photo: undefined })}>Remove photo</button>}
            </div>
            {!v.isCustom && <ColourPicker catalogId={v.catalogId} manufacturer={v.manufacturer} model={v.model} value={v.colour} onChange={c => upd({ colour: c })} />}
            {!v.photo && catalogPhoto(v.catalogId, v.manufacturer, v.model)?.credit && <span className="small faint">{catalogPhoto(v.catalogId, v.manufacturer, v.model)!.credit}</span>}
            {photoErr && <span className="small" style={{ color: 'var(--red)' }} role="alert">{photoErr}</span>}
          </div>
        </div>
      </section>

      <section className="card col">
        <h2>Ownership details</h2>
        <div className="form-grid">
          <Field label="Nickname"><input value={nick} onChange={e => setNick(e.target.value)} maxLength={40} /></Field>
          <Field label="Purchase date"><input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} /></Field>
          <Field label="Purchase price (₹)"><input type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} min={0} /></Field>
          <Field label="Your resale estimate (₹)" hint="Optional. Used only for the depreciation line in the ownership-cost estimate."><input type="number" inputMode="decimal" value={resale} onChange={e => setResale(e.target.value)} min={0} /></Field>
          <Field label="Registration number" full hint="Optional. Hidden by default and excluded from shared reports unless you include it.">
            <div className="row"><input value={reveal ? reg : reg ? maskReg(reg) : ''} readOnly={!reveal} onChange={e => setReg(e.target.value)} maxLength={20} autoComplete="off" placeholder="Not set" /><button className="btn small" type="button" onClick={() => setReveal(r => !r)}>{reveal ? 'Hide' : 'Show / edit'}</button></div>
          </Field>
        </div>
        <div><button className="btn primary" onClick={() => upd({
          nickname: nick.trim() || undefined, purchaseDate: purchaseDate || undefined, registration: reg.trim() || undefined,
          purchasePrice: price.trim() ? Number(price) : undefined, resaleEstimate: resale.trim() ? Number(resale) : undefined,
        })}>Save details</button></div>
      </section>

      <section className="card col">
        <h2>Danger zone</h2>
        <p className="muted small">Deleting a vehicle is recoverable from Backup &amp; restore → Recently deleted.</p>
        <div><button className="btn danger" onClick={onDelete}>Delete this vehicle</button></div>
      </section>
    </div>
  );
}
