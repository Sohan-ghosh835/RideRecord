import { useEffect, useRef, type ReactNode } from 'react';
import type { Category } from '../../domain/types';
import { categoryKind } from '../../lib/format';
import { catalogColours, catalogPhoto } from '../../lib/catalogPhotos';
import type { DueStatus } from '../../domain/maintenance';

const P: Record<string, string> = {
  fuel: 'M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M5 10h10M15 8h2.5a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8l-3-3',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01',
  gauge: 'M12 14l4-5M3.5 18a9.5 9.5 0 1 1 17 0M7 18h10',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  home: 'M3 11 12 3l9 8M5 10v10h14V10M10 20v-6h4v6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  x: 'M6 6l12 12M18 6 6 18',
  chev: 'M9 6l6 6-6 6',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  download: 'M12 5v14M5 12l7 7 7-7M5 20h14',
  smartphone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01',
};

export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ''} />
    </svg>
  );
}

/** Generic rider glyphs (original line art, not any manufacturer's artwork). */
export function Glyph({ category, className = 'glyph' }: { category: Category; className?: string }) {
  const kind = categoryKind(category);
  const ev = category.startsWith('electric');
  return (
    <svg className={className} viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={`${kind === 'scooter' ? 'Scooter' : 'Motorcycle'} illustration`}>
      <circle cx="24" cy="56" r="14" /><circle cx="96" cy="56" r="14" />
      {kind === 'scooter' ? (
        <>
          <path d="M96 56 88 28h-8M80 28l-6 4M24 56l14-14h28l10 14M38 42V30h20M58 56h20" />
          <path d="M84 20h10M62 30h14" />
        </>
      ) : kind === 'offroad' ? (
        <>
          <path d="M24 56 40 32h26l14 10 16 14M66 32l10-14h12M40 32l-6-8h-8M50 46h24" />
          <path d="M52 32 62 44" />
        </>
      ) : (
        <>
          <path d="M24 56 42 38h26l12 8 16 10M68 38l8-16h12M42 38l-4-10h-14M52 52h26" />
          <path d="M46 38h20l6 10" />
        </>
      )}
      {ev && <path d="M59 11l-6 11h7l-3 10 9-13h-7l3-8z" fill="currentColor" stroke="none" />}
    </svg>
  );
}

export function VehicleImage({ vehicle, className = 'glyph' }: { vehicle: { category: Category; photo?: string; colour?: string; catalogId?: string; manufacturer: string; model: string }; className?: string }) {
  const src = vehicle.photo ?? catalogPhoto(vehicle.catalogId, vehicle.manufacturer, vehicle.model, vehicle.colour)?.url;
  if (src) return <img src={src} alt={`${vehicle.manufacturer} ${vehicle.model}`} className={`${className} photo`} loading="lazy" />;
  return <Glyph category={vehicle.category} className={className} />;
}

/** Same lookup for a catalog entry (search results, profile header). */
export function CatalogImage({ entry, colour, className = 'glyph' }: { entry: { id: string; category: Category; manufacturer: string; model: string }; colour?: string; className?: string }) {
  return <VehicleImage vehicle={{ category: entry.category, catalogId: entry.id, manufacturer: entry.manufacturer, model: entry.model, colour }} className={className} />;
}

/** Choose a colour variant: a row of small photo tiles with the selected name shown below. */
export function ColourPicker({ catalogId, manufacturer, model, value, onChange, optional = true }: { catalogId?: string; manufacturer: string; model: string; value?: string; onChange: (c: string | undefined) => void; optional?: boolean }) {
  const colours = catalogColours(catalogId, manufacturer, model);
  if (!colours.length) return null;
  return (
    <div className="col" style={{ gap: '.5rem' }} role="radiogroup" aria-label="Colour">
      <div className="colours">
        {colours.map(c => (
          <button type="button" key={c.slug} role="radio" aria-checked={value === c.name} aria-label={c.name} title={c.name} className={`colour${value === c.name ? ' on' : ''}`} onClick={() => onChange(optional && value === c.name ? undefined : c.name)}>
            <img src={c.url} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <span className="small muted">{value ? <>Colour: <strong>{value}</strong></> : 'Tap a photo to choose your colour.'}{value && optional && <> · <button type="button" className="linklike" onClick={() => onChange(undefined)}>clear</button></>}</span>
    </div>
  );
}

export function Odometer({ value, digits = 6, dim = false }: { value?: number; digits?: number; dim?: boolean }) {
  const s = value === undefined ? ''.padStart(digits, '–') : String(Math.max(0, Math.round(value))).padStart(digits, '0').slice(-digits);
  return (
    <span className={`odo${dim || value === undefined ? ' dim' : ''}`} role="img" aria-label={value === undefined ? 'Odometer reading not recorded' : `Odometer ${value} kilometres`}>
      {s.split('').map((c, i) => <span key={i}>{c}</span>)}
    </span>
  );
}

export function Chip({ kind, children }: { kind?: string; children: ReactNode }) {
  return <span className={`chip ${kind ?? ''}`}>{children}</span>;
}

const DUE_LABEL: Record<DueStatus, string> = { ok: 'On track', soon: 'Due soon', due: 'Due', overdue: 'Overdue', unknown: 'Needs start point' };
export const DueChip = ({ status }: { status: DueStatus }) => <Chip kind={status}>{DUE_LABEL[status]}</Chip>;

export function Metric({ label, value, unit, note, na }: { label: string; value: ReactNode; unit?: string; note?: ReactNode; na?: boolean }) {
  return (
    <div className={`metric${na ? ' na' : ''}`}>
      <div className="label">{label}</div>
      <div className="v">{value}{unit && !na && <small>{unit}</small>}</div>
      {note && <div className="n">{note}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action && <div style={{ marginTop: '.9rem' }}>{action}</div>}</div>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="empty" role="status"><span className="spinner" aria-hidden="true" /><p className="small" style={{ marginTop: '.6rem' }}>{label}…</p></div>;
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="notice error" role="alert"><strong>Something went wrong.</strong> {error} Your saved records are unchanged. Reload the page to try again.</div>;
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={e => { e.preventDefault(); onClose(); }} aria-label={title}>
      {open && (
        <>
          <div className="dlg-head"><h2>{title}</h2><button className="btn ghost small" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
          <div className="dlg-body">{children}</div>
          {footer && <div className="dlg-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function Confirm({ open, title, body, confirmLabel = 'Delete', onConfirm, onCancel }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} footer={<><button className="btn" onClick={onCancel}>Cancel</button><button className="btn danger" onClick={onConfirm}>{confirmLabel}</button></>}>
      <div className="col">{body}</div>
    </Modal>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>;
}

export function Field({ label, hint, children, full }: { label: string; hint?: string; children: ReactNode; full?: boolean }) {
  return <label className={`field${full ? ' full' : ''}`}><span>{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>;
}

/** Errors block saving. Warnings can be acknowledged, so genuine corrections are never impossible. */
export function Feedback({ errors, warnings, ack, setAck }: { errors: string[]; warnings: string[]; ack: boolean; setAck: (b: boolean) => void }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <div className="col" style={{ gap: '.5rem' }}>
      {errors.length > 0 && <Notice kind="error"><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></Notice>}
      {warnings.length > 0 && !errors.length && (
        <Notice kind="warn">
          <strong>Please double-check</strong>
          <ul>{warnings.map(w => <li key={w}>{w}</li>)}</ul>
          <label className="check" style={{ marginTop: '.6rem' }}><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /><span>These are correct. Save anyway.</span></label>
        </Notice>
      )}
    </div>
  );
}
