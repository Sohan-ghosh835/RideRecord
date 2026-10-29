import { useState } from 'react';
import { eraseEverything } from '../../db/db';
import { applyRestore, backupFileName, exportBackup, parseBackup, previewRestore, type BackupFile, type RestoreMode, type RestorePreview } from '../../db/backup';
import { REMOVAL_LABEL } from '../../domain/types';
import { getMeta, listDeleted, purge, restoreDeleted, restoreVehicle, setMeta } from '../../db/repo';
import { download, fmtDate } from '../../lib/format';
import { useApp, useAsync } from '../../lib/store';
import { usePwaInstall } from '../../lib/usePwaInstall';
import { Confirm, Empty, Icon, Notice } from '../components/kit';

export default function Settings() {
  const { bump, toast } = useApp();
  const { canInstall, isInstalled, triggerInstall } = usePwaInstall();
  const info = useAsync(async () => {
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    return { lastBackup: await getMeta<string>('lastBackupAt'), deleted: await listDeleted(), usage: est?.usage, quota: est?.quota, persisted };
  }, []);
  const [withDocs, setWithDocs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<BackupFile>();
  const [mode, setMode] = useState<RestoreMode>('add-only');
  const [preview, setPreview] = useState<RestorePreview>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [eraseText, setEraseText] = useState('');
  const [erasing, setErasing] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<{ store: never; id: string; label: string }>();

  async function doExport() {
    setBusy(true); setError('');
    try {
      const f = await exportBackup({ includeDocuments: withDocs });
      download(backupFileName(), JSON.stringify(f));
      await setMeta('lastBackupAt', new Date().toISOString());
      bump(); toast(`Backup downloaded (${Object.values(f.counts).reduce((a, n) => a + n, 0)} records)`);
    } catch (e) { setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }

  async function choose(f?: File) {
    setFile(undefined); setPreview(undefined); setWarnings([]); setError('');
    if (!f) return;
    if (f.size > 200 * 1024 * 1024) { setError('That file is larger than 200 MB, which is more than a RideRecord backup should be.'); return; }
    const parsed = await parseBackup(await f.text());
    if (!parsed.ok) { setError(parsed.error); return; }
    setFile(parsed.file); setWarnings(parsed.warnings);
    setPreview(await previewRestore(parsed.file, mode));
  }
  async function changeMode(m: RestoreMode) { setMode(m); if (file) setPreview(await previewRestore(file, m)); }
  async function doRestore() {
    if (!preview) return;
    setBusy(true); setError('');
    try { const r = await applyRestore(preview); bump(); toast(`Restored ${r.written} record${r.written === 1 ? '' : 's'}`); setFile(undefined); setPreview(undefined); }
    catch (e) { setError(`Restore failed and nothing was changed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }

  const d = info.data;
  return (
    <main className="page stack-lg">
      {/* ── Install App ── */}
      <section className="card col install-card" id="install-app">
        <div className="row between" style={{ flexWrap: 'wrap', gap: '.75rem' }}>
          <div className="col" style={{ gap: '.25rem', flex: 1, minWidth: 200 }}>
            <h2><Icon name="smartphone" size={20} /> Install RideRecord</h2>
            <p className="muted small">
              {isInstalled
                ? 'RideRecord is installed on your device! It works fully offline and your data is stored locally.'
                : 'Install RideRecord on your device so it opens instantly, works offline, and uses your device\'s own storage — just like a native app.'}
            </p>
          </div>
          {isInstalled ? (
            <div className="chip ok" style={{ alignSelf: 'flex-start' }}>✓ Installed</div>
          ) : canInstall ? (
            <button className="btn primary" onClick={async () => { const ok = await triggerInstall(); if (ok) toast('App installed!'); }} id="pwa-install-btn">
              <Icon name="download" size={18} /> Install App
            </button>
          ) : (
            <button className="btn" onClick={() => {
              toast('Use your browser\'s menu → "Add to Home Screen" or "Install App"');
            }} id="pwa-install-btn">
              <Icon name="download" size={18} /> How to install
            </button>
          )}
        </div>

        {!isInstalled && (
          <details className="install-help">
            <summary className="small muted" style={{ cursor: 'pointer', marginTop: '.35rem' }}>
              <strong>Don't see the install button?</strong> Tap here for manual steps.
            </summary>
            <div className="col" style={{ gap: '.5rem', marginTop: '.6rem' }}>
              <Notice kind="info">
                <strong>Chrome / Edge (Android or Desktop):</strong><br />
                Tap the ⋮ menu → "Install app" or "Add to Home screen".
              </Notice>
              <Notice kind="info">
                <strong>Safari (iPhone / iPad):</strong><br />
                Tap the Share button (↑) → "Add to Home Screen".
              </Notice>
              <Notice kind="info">
                <strong>Firefox:</strong><br />
                Tap the ⋮ menu → "Install" or "Add to Home screen".
              </Notice>
            </div>
          </details>
        )}
      </section>

      <div><h1>Backup &amp; restore</h1><p className="muted">Your records live in this browser on this device. A backup file is how you move them to another device or recover from a lost phone or cleared browser data.</p></div>

      <Notice kind="info"><strong>Local-only by design.</strong> There is no account or cloud sync in this build, so nothing leaves your device and nothing is backed up for you. {d?.persisted ? 'Your browser has agreed to keep this data (persistent storage granted).' : 'Your browser may delete site data under storage pressure, so export backups regularly.'}</Notice>

      <section className="card col">
        <h2>Export</h2>
        <p className="muted small">{d?.lastBackup ? `Last backup: ${fmtDate(d.lastBackup)}.` : 'You have not exported a backup yet.'}{d?.usage !== undefined && d.quota ? ` Storage used: ${(d.usage / 1048576).toFixed(1)} MB of ${(d.quota / 1048576).toFixed(0)} MB available.` : ''}</p>
        <label className="check"><input type="checkbox" checked={withDocs} onChange={e => setWithDocs(e.target.checked)} /><span>Include document and receipt files <span className="muted small">(larger file; turn off for a quick records-only backup)</span></span></label>
        <div><button className="btn primary" onClick={doExport} disabled={busy}>Download backup</button></div>
      </section>

      <section className="card col">
        <h2>Restore</h2>
        <p className="muted small">Choose a backup file to preview first. Nothing is changed until you confirm, existing records are never deleted, and the restore is all-or-nothing.</p>
        <input type="file" accept="application/json,.json" onChange={e => choose(e.target.files?.[0])} aria-label="Choose backup file" />
        {error && <div className="notice error" role="alert">{error}</div>}
        {warnings.map(w => <Notice key={w} kind="warn">{w}</Notice>)}
        {file && preview && (
          <div className="col">
            <p className="small muted">Backup from {fmtDate(file.exportedAt)} · integrity check passed.</p>
            <div className="col" role="radiogroup" aria-label="Restore mode" style={{ gap: '.4rem' }}>
              <label className="check"><input type="radio" name="mode" checked={mode === 'add-only'} onChange={() => changeMode('add-only')} /><span><strong>Add missing records only</strong> (safest). Records already on this device are left exactly as they are.</span></label>
              <label className="check"><input type="radio" name="mode" checked={mode === 'newer-wins'} onChange={() => changeMode('newer-wins')} /><span><strong>Also update older records</strong> with newer versions from the backup. Records changed more recently on this device are kept.</span></label>
            </div>
            <div className="table-wrap"><table><thead><tr><th>Section</th><th className="num">In file</th><th className="num">To add</th><th className="num">Same</th><th className="num">Backup newer</th><th className="num">This device newer</th><th className="num">Invalid</th></tr></thead><tbody>
              {preview.stores.filter(s => s.total > 0).map(s => <tr key={s.store}><td>{s.store}</td><td className="num">{s.total}</td><td className="num">{s.add}</td><td className="num">{s.identical}</td><td className="num">{s.backupNewer}</td><td className="num">{s.localNewer}</td><td className="num">{s.invalid}</td></tr>)}
            </tbody></table></div>
            {preview.invalid.length > 0 && <Notice kind="warn"><strong>{preview.invalid.length} record{preview.invalid.length > 1 ? 's' : ''} will be skipped</strong><ul>{preview.invalid.slice(0, 8).map(i => <li key={i.store + i.id}>{i.store}: {i.label} ({i.reason})</li>)}</ul></Notice>}
            <div className="row"><button className="btn primary" onClick={doRestore} disabled={busy || preview.willWrite === 0}>{preview.willWrite === 0 ? 'Nothing to restore' : `Restore ${preview.willWrite} record${preview.willWrite === 1 ? '' : 's'}`}</button></div>
          </div>
        )}
      </section>

      <section className="card col">
        <h2>Recently deleted</h2>
        <p className="muted small">Deleted items are kept here until you remove them permanently.</p>
        {!d || d.deleted.length === 0 ? <Empty title="Nothing deleted">Deleted vehicles and records will appear here so you can bring them back.</Empty> : (
          <div className="list">{d.deleted.map(r => (
            <div className="li" key={r.store + r.id}><div className="grow"><div className="t">{r.label}</div><div className="s">Deleted {fmtDate(r.deletedAt)}{r.removal?.reason ? ` · ${REMOVAL_LABEL[r.removal.reason]}` : ''}{r.removal?.rating ? ` · ${'★'.repeat(r.removal.rating)}` : ''}</div>{r.removal?.note && <div className="s" style={{ fontStyle: 'italic' }}>“{r.removal.note}”</div>}</div>
              <button className="btn small" onClick={async () => { if (r.store === 'vehicles') await restoreVehicle(r.id); else await restoreDeleted(r.store, r.id); bump(); toast('Restored'); }}>Restore</button>
              <button className="btn small ghost danger" onClick={() => setPurgeTarget(r as never)}>Remove forever</button></div>
          ))}</div>
        )}
      </section>

      <section className="card col">
        <h2>Erase everything</h2>
        <p className="muted small">Wipes every bike, record, document, backup reminder and saved plan from this browser and starts RideRecord completely fresh. Export a backup first if you might want anything back. This cannot be undone.</p>
        <div className="row wrap">
          <input value={eraseText} onChange={e => setEraseText(e.target.value)} placeholder="Type ERASE to confirm" aria-label="Type ERASE to confirm" style={{ maxWidth: 260 }} autoComplete="off" />
          <button className="btn danger" disabled={eraseText.trim() !== 'ERASE' || erasing} onClick={async () => {
            setErasing(true); setError('');
            try { await eraseEverything(); window.location.hash = '#/'; window.location.reload(); }
            catch (e) { setError(e instanceof Error ? e.message : String(e)); setErasing(false); }
          }}>{erasing ? 'Erasing…' : 'Erase all data'}</button>
        </div>
      </section>

      <Confirm open={!!purgeTarget} title="Remove permanently?" confirmLabel="Remove forever" onCancel={() => setPurgeTarget(undefined)}
        onConfirm={async () => { if (purgeTarget) { await purge(purgeTarget.store, purgeTarget.id); } setPurgeTarget(undefined); bump(); toast('Removed permanently'); }}
        body={<><p>{purgeTarget?.label}</p><p className="muted small">This cannot be undone unless you have a backup that contains it.</p></>} />
    </main>
  );
}
