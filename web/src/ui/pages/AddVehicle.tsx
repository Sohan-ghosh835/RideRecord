import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createVehicleWithTasks, newId } from '../../db/repo';
import { groupByModel, inYearRange, manufacturers, searchCatalog, type SearchFilters, type SearchHit } from '../../domain/search';
import { todayIso } from '../../domain/calc';
import {
  CATEGORIES, CATEGORY_LABEL, FUEL_TYPES, SPEC_KEYS, SPEC_LABEL,
  type CatalogEntry, type Category, type Cooling, type DriveType, type FuelType, type Ownership, type SourceRef, type SpecKey, type Vehicle,
} from '../../domain/types';
import { remoteSearch, type RemoteStatus } from '../../lib/remote';
import { specText } from '../../lib/format';
import { useApp, useCatalog } from '../../lib/store';
import { Chip, CatalogImage, ColourPicker, ErrorBox, Feedback, Field, Glyph, Icon, Loading, Notice } from '../components/kit';

const LABEL = { exact: 'Name match', likely: 'Likely match', possible: 'Possible match' } as const;
const years = (e: CatalogEntry) => `${e.yearFrom}–${e.yearTo ?? 'present'}`;

export default function AddVehicle() {
  const catalog = useCatalog();
  const [picked, setPicked] = useState<CatalogEntry | 'custom' | null>(null);
  const [initialYear, setInitialYear] = useState<number | undefined>();
  const [initialQuery, setInitialQuery] = useState('');

  if (catalog.loading) return <main className="page"><Loading label="Loading catalog" /></main>;
  if (catalog.error || !catalog.data) return <main className="page"><ErrorBox error={catalog.error ?? 'Catalog unavailable'} /></main>;

  if (picked) {
    return (
      <main className="page">
        <ProfileForm entry={picked === 'custom' ? null : picked} catalog={catalog.data} initialYear={initialYear} seed={initialQuery} onBack={() => setPicked(null)} />
      </main>
    );
  }
  return <Finder catalog={catalog.data} onPick={(e, y, q) => { setInitialYear(y); setInitialQuery(q); setPicked(e); }} onCustom={q => { setInitialQuery(q); setPicked('custom'); }} />;
}

function Finder({ catalog, onPick, onCustom }: { catalog: CatalogEntry[]; onPick: (e: CatalogEntry, year: number | undefined, query: string) => void; onCustom: (q: string) => void }) {
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [remote, setRemote] = useState<{ entries: CatalogEntry[]; status: RemoteStatus }>({ entries: [], status: { state: 'not-configured' } });
  const brands = useMemo(() => manufacturers(catalog), [catalog]);

  useEffect(() => {
    if (q.trim().length < 3) { setRemote({ entries: [], status: { state: 'not-configured' } }); return; }
    const ctl = new AbortController();
    remoteSearch(q, ctl.signal).then(r => !ctl.signal.aborted && setRemote(r));
    return () => ctl.abort();
  }, [q]);

  const merged = useMemo(() => {
    const map = new Map(catalog.map(e => [e.id, e]));
    for (const e of remote.entries) map.set(e.id, e);
    return [...map.values()];
  }, [catalog, remote.entries]);

  const hasInput = q.trim() !== '' || !!filters.manufacturer || !!filters.category || !!filters.fuelType || !!filters.year;
  const result = useMemo(() => (hasInput ? searchCatalog(merged, q, filters) : undefined), [merged, q, filters, hasInput]);
  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K] | '') => setFilters(f => ({ ...f, [k]: v === '' ? undefined : v }));

  return (
    <main className="page stack-lg">
      <div><h1>Find your bike</h1><p className="muted">Type the brand, model, variant and year in any order. Misspellings are fine.</p></div>

      <div className="search-box" role="search">
        <Icon name="search" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. Royal Enfield Hunter 350 2025, Activa 6G, Duke 390 old model" aria-label="Search motorcycles and scooters" autoFocus autoComplete="off" />
      </div>

      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Field label="Manufacturer"><select value={filters.manufacturer ?? ''} onChange={e => set('manufacturer', e.target.value)}><option value="">All</option>{brands.map(b => <option key={b}>{b}</option>)}</select></Field>
        <Field label="Model year"><input type="number" inputMode="numeric" min={1950} max={new Date().getFullYear() + 1} value={filters.year ?? ''} onChange={e => set('year', e.target.value ? Number(e.target.value) : '')} placeholder="Any" /></Field>
        <Field label="Type"><select value={filters.category ?? ''} onChange={e => set('category', e.target.value as Category)}><option value="">All</option>{CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
        <Field label="Fuel"><select value={filters.fuelType ?? ''} onChange={e => set('fuelType', e.target.value as FuelType)}><option value="">All</option>{FUEL_TYPES.map(f => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}</select></Field>
      </div>

      {remote.status.state === 'unavailable' && <Notice kind="warn">The online catalog is not reachable right now ({remote.status.reason}) so you are seeing the catalog stored in the app. You can still pick a match or enter your bike manually.</Notice>}

      {!result && (
        <section className="col" aria-label="Browse by manufacturer">
          <h2>Or start from the manufacturer</h2>
          <div className="brand-grid">{brands.map(b => <button key={b} className="btn" onClick={() => set('manufacturer', b)}>{b}</button>)}</div>
        </section>
      )}

      {result && (
        <section className="col" aria-live="polite">
          {result.needsConfirmation && result.explanation && <Notice kind="warn"><strong>Please confirm which one is yours.</strong> {result.explanation}</Notice>}
          {!result.needsConfirmation && result.hits.length === 0 && <Notice kind="info">{result.explanation ?? 'Nothing matches those filters.'}</Notice>}
          <p className="small muted">{result.hits.length} result{result.hits.length === 1 ? '' : 's'}{result.parsed.year ? ` for ${result.parsed.year}` : ''}</p>
          <div className="col" style={{ gap: '.5rem' }}>
            {result.hits.map(h => <HitRow key={h.entry.id} hit={h} showLabel={!!q.trim()} onPick={() => onPick(h.entry, result.parsed.year, q)} />)}
          </div>
        </section>
      )}

      <div className="card row between wrap">
        <div className="grow"><h3>Can't find it?</h3><p className="muted small">Rare, imported or very new models may not be in the catalog yet. Create your own profile in a minute and carry on. Nothing is blocked.</p></div>
        <button className="btn" onClick={() => onCustom(query)}><Icon name="plus" /> Enter details manually</button>
      </div>
    </main>
  );
}

function HitRow({ hit, onPick, showLabel }: { hit: SearchHit; onPick: () => void; showLabel: boolean }) {
  const e = hit.entry;
  const cc = e.specs.displacement && typeof e.specs.displacement.value === 'number' ? `${e.specs.displacement.value} cc` : undefined;
  return (
    <button className="hit" onClick={onPick} aria-label={`Select ${e.manufacturer} ${e.model} ${e.generation ?? ''} ${years(e)}`}>
      <CatalogImage entry={e} />
      <div className="grow">
        <div style={{ fontWeight: 650 }}>{e.manufacturer} {e.model}{e.generation ? <span className="muted"> · {e.generation}</span> : null}</div>
        <div className="small muted">{years(e)} · {CATEGORY_LABEL[e.category]} · {e.fuelType}{cc ? ` · ${cc}` : ''}{e.status !== 'current' ? ` · ${e.status}` : ''}</div>
        <div className="row wrap" style={{ gap: '.35rem', marginTop: '.3rem' }}>
          {showLabel && <Chip kind={hit.label === 'possible' ? 'warn' : 'info'}>{LABEL[hit.label]}</Chip>}
          <Chip kind={e.verification}>{e.verification === 'verified' ? 'Verified specs' : e.verification === 'seed-unverified' ? 'Identification only' : e.verification}</Chip>
          {e.variants?.length ? <Chip>{e.variants.length} variants</Chip> : null}
        </div>
      </div>
      <Icon name="chev" />
    </button>
  );
}

// ---------------- Profile creation ----------------

const OWNERSHIP: { key: Ownership; title: string; body: string }[] = [
  { key: 'new', title: 'Just bought it new', body: 'Counting starts from your purchase date and the odometer at delivery.' },
  { key: 'used', title: 'Bought it used', body: 'We only know what you tell us. Add the last service if you have it.' },
  { key: 'long-owned', title: 'I have owned it for a while', body: 'Start tracking from today without needing your full history.' },
];

function ProfileForm({ entry, catalog, initialYear, seed, onBack }: { entry: CatalogEntry | null; catalog: CatalogEntry[]; initialYear?: number; seed: string; onBack: () => void }) {
  const nav = useNavigate();
  const { bump, toast } = useApp();
  const custom = entry === null;
  const thisYear = new Date().getFullYear();
  const defaultYear = entry ? (initialYear && inYearRange(entry, initialYear) ? initialYear : entry.yearTo ?? thisYear) : thisYear;

  const [manufacturer, setManufacturer] = useState(entry?.manufacturer ?? '');
  const [model, setModel] = useState(entry?.model ?? seed.replace(/\b(19|20)\d{2}\b/, '').trim());
  const [variant, setVariant] = useState('');
  const [variantChosen, setVariantChosen] = useState(false);
  const [year, setYear] = useState(String(defaultYear));
  const [category, setCategory] = useState<Category>(entry?.category ?? 'commuter');
  const [fuel, setFuel] = useState<FuelType>(entry?.fuelType ?? 'petrol');
  const [drive, setDrive] = useState<DriveType>(entry?.drive ?? 'chain');
  const [cooling, setCooling] = useState<Cooling>(entry?.cooling ?? 'unknown');
  const [nickname, setNickname] = useState('');
  const [colour, setColour] = useState<string | undefined>();
  const [ownership, setOwnership] = useState<Ownership>('new');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [price, setPrice] = useState('');
  const [odo, setOdo] = useState('');
  const [lastSvcDate, setLastSvcDate] = useState('');
  const [lastSvcOdo, setLastSvcOdo] = useState('');
  const [tank, setTank] = useState('');
  const [registration, setRegistration] = useState('');
  const [queue, setQueue] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isEv = fuel === 'electric';
  const yearOptions = entry
    ? Array.from({ length: (entry.yearTo ?? thisYear + 1) - entry.yearFrom + 1 }, (_, i) => (entry.yearTo ?? thisYear + 1) - i)
    : [];
  const brands = useMemo(() => manufacturers(catalog), [catalog]);
  const siblings = useMemo(() => entry ? groupByModel(catalog.filter(c => c.manufacturer === entry.manufacturer && c.model === entry.model)) : [], [catalog, entry]);

  async function create() {
    const errs: string[] = [];
    if (!manufacturer.trim()) errs.push('Enter the manufacturer.');
    if (!model.trim()) errs.push('Enter the model.');
    const y = Number(year);
    if (!Number.isInteger(y) || y < 1950 || y > thisYear + 1) errs.push('Enter a valid model year.');
    if (entry?.variants?.length && !variantChosen) errs.push('Choose your variant, or pick "Not sure / other" so we never guess it for you.');
    const oNum = odo.trim() === '' ? undefined : Number(odo);
    if (oNum !== undefined && (!Number.isFinite(oNum) || oNum < 0)) errs.push('Odometer must be a number, 0 or more.');
    if (ownership === 'long-owned' && oNum === undefined) errs.push('Enter your current odometer reading so distance-based reminders can work.');
    if (purchaseDate && purchaseDate > todayIso()) errs.push('Purchase date cannot be in the future.');
    const pr = price.trim() === '' ? undefined : Number(price);
    if (pr !== undefined && (!Number.isFinite(pr) || pr < 0)) errs.push('Purchase price must be 0 or more.');
    const tk = tank.trim() === '' ? undefined : Number(tank);
    if (tk !== undefined && !(tk > 0)) errs.push(`${isEv ? 'Battery' : 'Tank'} capacity must be more than 0.`);
    setErrors(errs);
    if (errs.length) return;

    const now = new Date().toISOString();
    const sources: SourceRef[] = entry ? entry.sources : [{ kind: 'user', label: 'Entered by the owner', retrieved: todayIso() }];
    const overrides: Vehicle['specOverrides'] = {};
    if (tk !== undefined) overrides[isEv ? 'battery' : 'tank'] = { value: tk, unit: isEv ? 'kWh' : 'L', verification: 'user-entered' };

    const v: Vehicle = {
      id: newId(), nickname: nickname.trim() || undefined, manufacturer: manufacturer.trim(), model: model.trim(), variant: variant.trim() || undefined, year: y,
      category, fuelType: fuel, drive: fuel === 'electric' ? 'electric' : drive, cooling, catalogId: entry?.id, catalogUpdatedAt: entry?.updatedAt, isCustom: custom, colour,
      specSnapshot: entry ? structuredClone(entry.specs) : {}, specOverrides: overrides, sources, ownership,
      purchaseDate: purchaseDate || undefined, purchasePrice: pr, initialOdometer: oNum, registration: registration.trim() || undefined,
      reviewQueued: custom && queue, createdAt: now, updatedAt: now,
    };
    // Where distance/time counting starts for each maintenance task.
    const lsOdo = lastSvcOdo.trim() === '' ? undefined : Number(lastSvcOdo);
    const baseline = ownership === 'new'
      ? { odo: oNum, date: purchaseDate || todayIso() }
      : lastSvcDate || lsOdo !== undefined
        ? { odo: lsOdo, date: lastSvcDate || undefined }
        : { odo: oNum, date: todayIso() };
    setBusy(true);
    try {
      const { vehicle } = await createVehicleWithTasks(v, baseline, custom && queue);
      bump(); toast(`${vehicle.manufacturer} ${vehicle.model} added to your garage`);
      nav(`/v/${vehicle.id}`);
    } catch (e) {
      setErrors([`Could not save the vehicle: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`]);
    } finally { setBusy(false); }
  }

  const shownSpecs = entry ? SPEC_KEYS.filter(k => entry.specs[k]) : [];
  return (
    <div className="stack-lg">
      <div className="row"><button className="btn ghost small" onClick={onBack}>← Back to search</button></div>
      <div className="hero card">
        {entry ? <CatalogImage entry={entry} colour={colour} className="glyph big" /> : <Glyph category={category} />}
        <div className="grow">
          <h1>{custom ? 'Create a custom profile' : `${entry!.manufacturer} ${entry!.model}`}</h1>
          <p className="muted">{custom ? 'We could not find a matching catalog entry. Tell us what you ride and you can start recording right away.' : [entry!.generation, years(entry!), CATEGORY_LABEL[entry!.category]].filter(Boolean).join(' · ')}</p>
        </div>
        {entry && <Chip kind={entry.verification}>{entry.verification === 'seed-unverified' ? 'Identification only' : entry.verification}</Chip>}
      </div>

      <div className="grid cols-2 lg-main">
        <div className="col">
          <section className="card col">
            <h2>{custom ? 'Your vehicle' : 'Confirm your vehicle'}</h2>
            <div className="form-grid">
              {custom ? (
                <>
                  <Field label="Manufacturer"><input list="brands" value={manufacturer} onChange={e => setManufacturer(e.target.value)} maxLength={60} required /><datalist id="brands">{brands.map(b => <option key={b} value={b} />)}</datalist></Field>
                  <Field label="Model"><input value={model} onChange={e => setModel(e.target.value)} maxLength={80} required /></Field>
                  <Field label="Variant / trim (optional)"><input value={variant} onChange={e => { setVariant(e.target.value); setVariantChosen(true); }} maxLength={60} /></Field>
                  <Field label="Model year"><input type="number" inputMode="numeric" value={year} onChange={e => setYear(e.target.value)} min={1950} max={thisYear + 1} /></Field>
                  <Field label="Type"><select value={category} onChange={e => { const c = e.target.value as Category; setCategory(c); if (c.startsWith('electric')) setFuel('electric'); else if (c === 'scooter') setDrive('belt'); }}>{CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
                  <Field label="Fuel"><select value={fuel} onChange={e => setFuel(e.target.value as FuelType)}>{FUEL_TYPES.map(f => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}</select></Field>
                </>
              ) : (
                <>
                  <Field label="Model year" hint={`Built ${years(entry!)}`}><select value={year} onChange={e => setYear(e.target.value)}>{yearOptions.map(y => <option key={y}>{y}</option>)}</select></Field>
                  {entry!.variants?.length ? (
                    <Field label="Variant" hint="Choose yours. We don't guess.">
                      <select value={variantChosen ? variant : '__unset'} onChange={e => { setVariantChosen(true); setVariant(e.target.value === '__other' ? '' : e.target.value); }}>
                        <option value="__unset" disabled>Select…</option>
                        {entry!.variants.map(v => <option key={v}>{v}</option>)}
                        <option value="__other">Not sure / other</option>
                      </select>
                    </Field>
                  ) : <Field label="Variant (optional)"><input value={variant} onChange={e => setVariant(e.target.value)} maxLength={60} /></Field>}
                </>
              )}
              {entry && <div className="full"><ColourPicker catalogId={entry.id} manufacturer={entry.manufacturer} model={entry.model} value={colour} onChange={setColour} /></div>}
              <Field label="Nickname (optional)"><input value={nickname} onChange={e => setNickname(e.target.value)} maxLength={40} placeholder="Shown instead of the model name" /></Field>
              {!isEv && (entry === null || entry.drive === 'unknown') && (
                <Field label="Final drive" hint="Decides which maintenance tasks apply"><select value={drive} onChange={e => setDrive(e.target.value as DriveType)}><option value="chain">Chain</option><option value="belt">Belt (CVT scooter / belt drive)</option><option value="shaft">Shaft</option></select></Field>
              )}
              {!isEv && (entry === null || entry.cooling === 'unknown') && (
                <Field label="Cooling" hint="Liquid-cooled engines get a coolant task"><select value={cooling} onChange={e => setCooling(e.target.value as Cooling)}><option value="unknown">Not sure</option><option value="air">Air</option><option value="oil">Oil</option><option value="liquid">Liquid</option></select></Field>
              )}
            </div>
          </section>

          <section className="card col">
            <h2>Your ownership</h2>
            <div className="col" role="radiogroup" aria-label="How did you get it?" style={{ gap: '.5rem' }}>
              {OWNERSHIP.map(o => (
                <label key={o.key} className="hit" style={{ borderColor: ownership === o.key ? 'var(--accent)' : undefined }}>
                  <input type="radio" name="own" checked={ownership === o.key} onChange={() => setOwnership(o.key)} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
                  <span className="grow"><strong>{o.title}</strong><br /><span className="small muted">{o.body}</span></span>
                </label>
              ))}
            </div>
            {isEv && <Notice kind="info">Electric: charging is tracked in kWh and cost per km. No engine-oil, spark-plug or chain tasks are added.</Notice>}
            <div className="form-grid">
              <Field label={ownership === 'long-owned' ? 'Purchase date (optional)' : 'Purchase date'}><input type="date" value={purchaseDate} max={todayIso()} onChange={e => setPurchaseDate(e.target.value)} /></Field>
              <Field label="Purchase price (₹, optional)"><input type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} min={0} /></Field>
              <Field label={ownership === 'long-owned' ? 'Current odometer (km)' : 'Odometer when you got it (km)'} hint={ownership === 'new' ? 'Leave empty if you will add it later' : undefined}>
                <input type="number" inputMode="decimal" value={odo} onChange={e => setOdo(e.target.value)} min={0} step="any" />
              </Field>
              <Field label={isEv ? 'Battery capacity (kWh, optional)' : 'Fuel tank (litres, optional)'} hint="Used only to flag typing mistakes"><input type="number" inputMode="decimal" value={tank} onChange={e => setTank(e.target.value)} min={0} step="any" /></Field>
              {ownership !== 'new' && (
                <>
                  <Field label="Last service date (optional)"><input type="date" value={lastSvcDate} max={todayIso()} onChange={e => setLastSvcDate(e.target.value)} /></Field>
                  <Field label="Last service odometer (optional)"><input type="number" inputMode="decimal" value={lastSvcOdo} onChange={e => setLastSvcOdo(e.target.value)} min={0} step="any" /></Field>
                  <p className="small muted full">Without a last-service date, maintenance counting starts today. You can set when each task was last done from the Service tab.</p>
                </>
              )}
              <Field label="Registration number (optional)" full hint="Kept on this device, hidden by default and left out of shared reports unless you include it."><input value={registration} onChange={e => setRegistration(e.target.value)} maxLength={20} autoComplete="off" /></Field>
            </div>
            {custom && <label className="check"><input type="checkbox" checked={queue} onChange={e => setQueue(e.target.checked)} /><span>Add this model to the catalog review queue so it can be verified and added for everyone.</span></label>}
            <Feedback errors={errors} warnings={[]} ack={false} setAck={() => {}} />
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create vehicle profile'}</button></div>
          </section>
        </div>

        <aside className="col">
          <section className="card">
            <h2>Specifications</h2>
            {custom ? <p className="muted small" style={{ marginTop: '.5rem' }}>Custom vehicles start with no catalog specifications. Add figures from your owner's manual later and they are labelled as entered by you.</p> : shownSpecs.length === 0 ? (
              <Notice kind="info"><strong>No verified figures yet.</strong> This catalog entry identifies the model but carries no sourced performance, weight or capacity numbers, and RideRecord will not guess them. Add figures from your manual on the Specs tab.</Notice>
            ) : (
              <div style={{ marginTop: '.5rem' }}>{shownSpecs.map((k: SpecKey) => { const s = entry!.specs[k]!; const t = specText(k, s); return (
                <div className="spec-row" key={k}><span className="muted">{SPEC_LABEL[k]}</span><span>{t.main} <Chip kind={s.verification}>{s.verification === 'seed-unverified' ? 'unverified' : s.verification}</Chip></span></div>
              ); })}</div>
            )}
            {entry && <details style={{ marginTop: '.8rem' }}><summary className="small muted" style={{ cursor: 'pointer' }}>Where this information comes from</summary><ul className="small muted">{entry.sources.map((s, i) => <li key={i}>{s.label}{s.url && <> · <a href={s.url} target="_blank" rel="noreferrer noopener">source</a></>}{s.retrieved && ` · retrieved ${s.retrieved}`}</li>)}</ul></details>}
          </section>
          {siblings.length > 0 && siblings[0].entries.length > 1 && <Notice kind="info">This model has {siblings[0].entries.length} generations in the catalog. Check you picked the right one on the previous screen.</Notice>}
        </aside>
      </div>
    </div>
  );
}
