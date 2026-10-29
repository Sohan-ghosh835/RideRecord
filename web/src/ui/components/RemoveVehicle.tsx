import { useState } from 'react';
import { softDeleteVehicle } from '../../db/repo';
import { REMOVAL_LABEL, type RemovalReason, type Vehicle } from '../../domain/types';
import { vehicleTitle } from '../../lib/format';
import { Modal } from './kit';

const REASONS = Object.keys(REMOVAL_LABEL) as RemovalReason[];

/** Remove a bike from the garage. Everything here is optional and the bike can be restored afterwards. */
export function RemoveVehicleDialog({ vehicle, open, onClose, onDone }: { vehicle: Vehicle; open: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<RemovalReason | undefined>();
  const [rating, setRating] = useState<number | undefined>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const close = () => { setReason(undefined); setRating(undefined); setNote(''); setErr(''); onClose(); };
  async function remove() {
    setBusy(true); setErr('');
    try { await softDeleteVehicle(vehicle.id, undefined, { reason, rating, note: note.trim() || undefined }); setReason(undefined); setRating(undefined); setNote(''); onDone(); }
    catch (e) { setErr(`Could not remove it: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={close} title={`Remove ${vehicleTitle(vehicle)}?`}
      footer={<><button className="btn" onClick={close}>Keep it</button><button className="btn danger" onClick={remove} disabled={busy}>{busy ? 'Removing…' : 'Remove from garage'}</button></>}>
      <div className="col">
        <p>This takes the bike and its fuel logs, expenses, service history, reminders and documents out of your garage.</p>
        <p className="muted small">Nothing is erased: you can bring it all back from <strong>Backup → Recently deleted</strong>.</p>

        <fieldset className="col reasons" style={{ border: 0, padding: 0, margin: 0, gap: '.4rem' }}>
          <legend className="label" style={{ marginBottom: '.4rem' }}>Why are you removing it? (optional)</legend>
          {REASONS.map(r => (
            <label key={r} className={`hit reason${reason === r ? ' on' : ''}`}>
              <input type="radio" name="why" checked={reason === r} onChange={() => setReason(r)} onClick={() => reason === r && setReason(undefined)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
              <span className="grow">{REMOVAL_LABEL[r]}</span>
            </label>
          ))}
        </fieldset>

        <div className="col" style={{ gap: '.4rem' }}>
          <span className="label">Your review of the bike (optional)</span>
          <div className="stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={`star${rating && n <= rating ? ' on' : ''}`} onClick={() => setRating(rating === n ? undefined : n)}>★</button>
            ))}
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="What was it like to own? Anything you'd tell the next owner?" aria-label="Your review" />
        </div>
        {err && <div className="notice error" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}
