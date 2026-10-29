import { useMemo, useState } from 'react';
import { getDocumentData, save, softDelete } from '../../db/repo';
import { expiryStatus } from '../../domain/maintenance';
import { DOC_LABEL, type DocumentRec } from '../../domain/types';
import { fmtDate } from '../../lib/format';
import { useApp } from '../../lib/store';
import { Chip, Confirm, Empty, Field } from '../components/kit';
import { DocForm } from '../components/forms';
import type { VCtx } from './VehicleLayout';

type Meta = Omit<DocumentRec, 'data'>;

export default function Docs({ bundle: b }: VCtx) {
  const { bump, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [del, setDel] = useState<Meta>();
  const [err, setErr] = useState('');

  const docs = useMemo(() => {
    const t = q.trim().toLowerCase();
    return b.documents.filter(d => !t || `${d.title} ${DOC_LABEL[d.type]} ${d.fileName} ${d.notes ?? ''}`.toLowerCase().includes(t))
      .sort((x, y) => (x.expiry ?? '9999').localeCompare(y.expiry ?? '9999'));
  }, [b.documents, q]);

  async function view(d: Meta) {
    setErr('');
    const full = await getDocumentData(d.id);
    if (!full || !full.data.byteLength) { setErr('The file for this document is not stored on this device (it may have been restored from a backup exported without files).'); return; }
    const url = URL.createObjectURL(new Blob([full.data], { type: full.mime }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async function saveFile(d: Meta) {
    const full = await getDocumentData(d.id);
    if (!full?.data.byteLength) { setErr('No file stored for this document.'); return; }
    const url = URL.createObjectURL(new Blob([full.data], { type: full.mime }));
    const a = document.createElement('a'); a.href = url; a.download = d.fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div><h2>Document wallet</h2><p className="muted small">Insurance, registration, PUC, invoices and warranty. Stored in this browser on this device, not uploaded anywhere.</p></div>
        <button className="btn primary no-print" onClick={() => setAdding(true)}>Add document</button>
      </div>
      {err && <div className="notice error" role="alert">{err}</div>}
      {b.documents.length > 0 && <Field label="Search documents"><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Title, type or file name" /></Field>}
      {docs.length === 0 ? (
        <div className="card"><Empty title={b.documents.length ? 'No matching documents' : 'No documents yet'} action={!b.documents.length && <button className="btn primary" onClick={() => setAdding(true)}>Add your first document</button>}>Add an expiry date and RideRecord flags it on your dashboard before it lapses.</Empty></div>
      ) : (
        <div className="card list">
          {docs.map(d => {
            const s = expiryStatus(d.expiry, d.reminderDays);
            return (
              <div className="li" key={d.id} style={{ flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 200 }}>
                  <div className="t">{d.title}</div>
                  <div className="s">{DOC_LABEL[d.type]} · {d.fileName} · {(d.size / 1024).toFixed(0)} KB{d.expiry ? ` · expires ${fmtDate(d.expiry)}` : ''}</div>
                  {d.notes && <div className="s">{d.notes}</div>}
                </div>
                {s !== 'none' && <Chip kind={s === 'expired' ? 'expired' : s === 'soon' ? 'soon' : 'ok'}>{s === 'expired' ? 'Expired' : s === 'soon' ? 'Expiring soon' : 'Valid'}</Chip>}
                <span className="no-print" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small" onClick={() => view(d)}>Open</button>
                  <button className="btn small ghost" onClick={() => saveFile(d)}>Download</button>
                  <button className="btn small ghost" onClick={async () => { const nx = prompt('New expiry date (YYYY-MM-DD), blank to clear', d.expiry ?? ''); if (nx === null) return; if (nx && !/^\d{4}-\d{2}-\d{2}$/.test(nx)) { setErr('Use the format YYYY-MM-DD.'); return; } const full = await getDocumentData(d.id); if (full) { await save('documents', { ...full, expiry: nx || undefined }); bump(); toast('Expiry updated'); } }}>Expiry</button>
                  <button className="btn small ghost danger" onClick={() => setDel(d)}>Delete</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {adding && <DocForm bundle={b} onClose={() => setAdding(false)} />}
      <Confirm open={!!del} title="Delete this document?" onCancel={() => setDel(undefined)}
        onConfirm={async () => { if (del) await softDelete('documents', del.id); setDel(undefined); bump(); toast('Document deleted. Restore it from Backup & restore.'); }}
        body={<p>{del?.title}<br /><span className="muted small">The file stays recoverable from Recently deleted.</span></p>} />
    </div>
  );
}
