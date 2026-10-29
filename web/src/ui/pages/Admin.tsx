import { useMemo, useState } from 'react';
import { listOverlay, listSuggestions, putOverlay, save } from '../../db/repo';
import { catalogCoverage, findDuplicates, mergeCatalog, validateCatalogEntry } from '../../domain/catalog';
import { SEED_CATALOG } from '../../domain/catalogSeed';
import type { CatalogEntry, Suggestion } from '../../domain/types';
import { API_URL } from '../../lib/remote';
import { download } from '../../lib/format';
import { useApp, useAsync } from '../../lib/store';
import { photoCoverage } from '../../lib/catalogPhotos';
import { Chip, Empty, Loading, Notice } from '../components/kit';

const TEMPLATE = {
  records: [{
    manufacturer: 'Example Motors', model: 'Example 125', generation: 'Mk1', aliases: ['ex125'], yearFrom: 2024, yearTo: null, market: 'IN',
    category: 'commuter', fuelType: 'petrol', drive: 'chain', cooling: 'air', verification: 'verified',
    sources: [{ kind: 'manufacturer', label: 'Official brochure (replace with the real source)', url: 'https://example.com/brochure.pdf', retrieved: '2026-10-17' }],
    specs: { displacement: { value: 124, unit: 'cc', verification: 'verified', sourceIndex: 0 } },
  }],
};

export default function Admin() {
  const { bump, toast } = useApp();
  const data = useAsync(async () => ({ overlay: await listOverlay(), suggestions: await listSuggestions() }), []);
  const [report, setReport] = useState<{ ok: CatalogEntry[]; bad: { i: number; errors: string[] }[]; warn: string[]; conflicts: string[] }>();
  const [err, setErr] = useState('');

  const catalog = useMemo(() => mergeCatalog(data.data?.overlay ?? []), [data.data]);
  const cov = useMemo(() => catalogCoverage(catalog), [catalog]);
  const dups = useMemo(() => findDuplicates(catalog), [catalog]);

  async function pick(f?: File) {
    setReport(undefined); setErr('');
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setErr('File is larger than 20 MB.'); return; }
    let json: unknown;
    try { json = JSON.parse(await f.text()); } catch { setErr('That file is not valid JSON.'); return; }
    const arr = Array.isArray(json) ? json : (json as { records?: unknown[] })?.records;
    if (!Array.isArray(arr)) { setErr('Expected a JSON array of records, or an object with a "records" array.'); return; }
    const ok: CatalogEntry[] = [], bad: { i: number; errors: string[] }[] = [], warn: string[] = [], conflicts: string[] = [];
    arr.slice(0, 5000).forEach((raw, i) => {
      const v = validateCatalogEntry(raw);
      if (!v.ok) bad.push({ i: i + 1, errors: v.errors });
      else {
        ok.push(v.entry); v.warnings.forEach(w => warn.push(`#${i + 1} ${v.entry.model}: ${w}`));
        const existing = catalog.find(c => c.id === v.entry.id);
        if (existing && existing.verification === 'verified' && v.entry.verification !== 'verified') conflicts.push(`${v.entry.manufacturer} ${v.entry.model}: would replace a verified record with a ${v.entry.verification} one.`);
      }
    });
    setReport({ ok, bad, warn, conflicts });
  }

  async function commit() {
    if (!report) return;
    const skip = new Set(report.conflicts.map(c => c));
    const safe = report.ok.filter(e => !skip.has(`${e.manufacturer} ${e.model}: would replace a verified record with a ${e.verification} one.`));
    await putOverlay(safe);
    bump(); setReport(undefined); toast(`Imported ${safe.length} catalog record${safe.length === 1 ? '' : 's'}. Existing vehicles are unaffected.`);
  }

  const upd = async (s: Suggestion, status: Suggestion['status']) => { await save('suggestions', { ...s, status }); bump(); };

  if (data.loading) return <main className="page"><Loading /></main>;
  return (
    <main className="page stack-lg">
      <div><h1>Catalog quality</h1><p className="muted">Coverage, review queue and verified-data import. Coverage is measured from the records actually present, nothing is assumed.</p></div>

      <Notice kind="warn"><strong>The built-in catalog is identification-only.</strong> It lets riders find and name their model, but carries no verified power, weight, capacity or service-interval figures. Verified records come from importing sourced data (below) or the backend ingestion service. Production years in the seed are approximate.</Notice>

      <section className="card col">
        <h2>Coverage</h2>
        <div className="metrics wide">
          <div className="metric"><div className="label">Records</div><div className="v">{cov.total}</div></div>
          <div className="metric"><div className="label">Verified</div><div className="v">{cov.byVerification.verified}</div></div>
          <div className="metric"><div className="label">Identification only</div><div className="v">{cov.byVerification['seed-unverified']}</div></div>
          <div className="metric"><div className="label">Without any source</div><div className="v">{cov.withoutSources}</div></div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Manufacturer</th><th className="num">Models</th><th className="num">Verified</th></tr></thead><tbody>{cov.byManufacturer.map(m => <tr key={m.manufacturer}><td>{m.manufacturer}</td><td className="num">{m.total}</td><td className="num">{m.verified}</td></tr>)}</tbody></table></div>
        <p className="small muted">Bundled seed records: {SEED_CATALOG.length}. Imported records: {data.data?.overlay.length ?? 0}. Online catalog service: {API_URL ? `configured (${API_URL})` : 'not configured'}.</p>
      </section>

      <section className="card col">
        <h2>Import verified records</h2>
        <p className="muted small">Upload a JSON file of catalog records. Each record is validated and sanitised, a preview is shown first, and "verified" is only kept when an official manufacturer, manual or distributor source is attached. Imports sit beside the built-in catalog and never touch anyone's vehicle profiles.</p>
        <div className="row wrap"><input type="file" accept="application/json,.json" onChange={e => pick(e.target.files?.[0])} aria-label="Choose catalog JSON" /><button className="btn small" onClick={() => download('catalog-template.json', JSON.stringify(TEMPLATE, null, 2))}>Download template</button></div>
        {err && <div className="notice error" role="alert">{err}</div>}
        {report && (
          <div className="col">
            <p><strong>{report.ok.length}</strong> valid · <strong>{report.bad.length}</strong> rejected</p>
            {report.bad.length > 0 && <Notice kind="error"><ul>{report.bad.slice(0, 10).map(b => <li key={b.i}>Record {b.i}: {b.errors.join('; ')}</li>)}</ul></Notice>}
            {report.warn.length > 0 && <Notice kind="warn"><ul>{report.warn.slice(0, 10).map(w => <li key={w}>{w}</li>)}</ul></Notice>}
            {report.conflicts.length > 0 && <Notice kind="warn"><strong>Skipped to protect verified data:</strong><ul>{report.conflicts.map(c => <li key={c}>{c}</li>)}</ul></Notice>}
            <div><button className="btn primary" onClick={commit} disabled={!report.ok.length}>Import {report.ok.length - report.conflicts.length} record{report.ok.length - report.conflicts.length === 1 ? '' : 's'}</button></div>
          </div>
        )}
      </section>

      <section className="card col">
        <h2>Bike photos</h2>
        {(() => { const c = photoCoverage(); const missing = c.rows.filter(r => !r.has); return (<>
          <p className="muted small"><strong>{c.have}</strong> of {c.total} catalog bikes have a photo. Add a PNG, JPG or WebP named after the catalog id to <span className="mono">src/bike-photos/</span> and rebuild. Only use images you own or are licensed to reuse, and note credits in <span className="mono">credits.json</span>.</p>
          {missing.length > 0 && <details><summary className="small" style={{ cursor: 'pointer' }}>{missing.length} still need a photo (filename shown)</summary><div className="table-wrap"><table><thead><tr><th>Bike</th><th>File name</th></tr></thead><tbody>{missing.map(r => <tr key={r.id}><td>{r.label}</td><td className="mono small">{r.id}.png</td></tr>)}</tbody></table></div></details>}
        </>); })()}
      </section>

      <section className="card col">
        <h2>Review queue</h2>
        {!data.data?.suggestions.length ? <Empty title="Nothing to review">Custom vehicles that riders choose to submit appear here. They never become trusted catalog data automatically.</Empty> : (
          <div className="list">{data.data.suggestions.map(s => {
            const p = s.payload as Record<string, unknown>;
            return <div className="li" key={s.id}><div className="grow"><div className="t">{String(p.manufacturer)} {String(p.model)} {p.year ? `(${String(p.year)})` : ''}</div><div className="s">{s.kind} · submitted {s.createdAt.slice(0, 10)}</div></div><Chip kind={s.status === 'pending' ? 'warn' : 'info'}>{s.status}</Chip>{s.status === 'pending' && <><button className="btn small" onClick={() => upd(s, 'accepted')}>Mark reviewed</button><button className="btn small ghost" onClick={() => upd(s, 'dismissed')}>Dismiss</button></>}</div>;
          })}</div>
        )}
      </section>

      <section className="card col">
        <h2>Possible duplicates</h2>
        {dups.length === 0 ? <p className="muted small">No duplicate records detected.</p> : <ul>{dups.map(([a, b]) => <li key={a.id + b.id}>{a.manufacturer} {a.model} ({a.id}) and {b.id}</li>)}</ul>}
      </section>
    </main>
  );
}
