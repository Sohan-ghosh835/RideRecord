import { useState } from 'react';
import { save, softDelete } from '../../db/repo';
import { computeDue, sortByUrgency } from '../../domain/maintenance';
import type { MaintenanceTask, ServiceRecord } from '../../domain/types';
import { fmtDate, inr, km } from '../../lib/format';
import { useApp } from '../../lib/store';
import { Chip, Confirm, DueChip, Empty, Notice } from '../components/kit';
import { ServiceForm, TaskForm } from '../components/forms';
import type { VCtx } from './VehicleLayout';

const SRC: Record<MaintenanceTask['source'], { label: string; kind: string }> = {
  manufacturer: { label: 'Manufacturer interval', kind: 'verified' },
  'generic-default': { label: 'Generic starting point', kind: 'estimated' },
  user: { label: 'My reminder', kind: 'user-entered' },
};

export default function Service({ bundle: b, open }: VCtx) {
  const { bump, toast } = useApp();
  const [complete, setComplete] = useState<string[] | null>(null);
  const [editSvc, setEditSvc] = useState<ServiceRecord>();
  const [delSvc, setDelSvc] = useState<ServiceRecord>();
  const [taskForm, setTaskForm] = useState<MaintenanceTask | 'new' | null>(null);

  const rows = sortByUrgency(b.tasks.map(task => ({ task, due: computeDue(task, b.services, b.lastOdo?.km) })));
  const active = rows.filter(r => r.task.enabled);
  const paused = rows.filter(r => !r.task.enabled);
  const hasGeneric = b.tasks.some(t => t.source === 'generic-default');

  return (
    <div className="stack-lg">
      <div className="row between wrap">
        <div><h2>Maintenance plan</h2><p className="muted small">Each task is due when its distance or time limit is reached, whichever comes first.</p></div>
        <div className="row no-print"><button className="btn" onClick={() => setTaskForm('new')}>Add reminder</button><button className="btn primary" onClick={() => open('service')}>Log service</button></div>
      </div>

      {hasGeneric && <Notice kind="warn"><strong>These intervals are generic starting points, not your manufacturer's schedule.</strong> RideRecord has no verified service intervals for this model. Check your owner's manual and edit each rule, then mark its source as "Manufacturer / owner's manual".</Notice>}
      {b.lastOdo === undefined && <Notice kind="info">Add an odometer reading so distance limits can be tracked. Until then only the time limits are evaluated.</Notice>}

      {active.length === 0 ? <div className="card"><Empty title="No maintenance rules">Add a reminder to start tracking.</Empty></div> : (
        <section className="card">
          <div className="list">
            {active.map(({ task, due }) => (
              <div className="li" key={task.id} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 220 }}>
                  <div className="t">{task.name}</div>
                  <div className="s">{[task.intervalKm !== undefined && `every ${km(task.intervalKm)}`, task.intervalMonths !== undefined && `every ${task.intervalMonths} mo`].filter(Boolean).join(' or ')}</div>
                  <div className="s">{due.message}{due.dueOdo !== undefined ? ` · due at ${km(due.dueOdo)}` : ''}{due.dueDate ? ` · by ${fmtDate(due.dueDate)}` : ''}</div>
                  <div className="s">{due.lastDone ? `Last done ${fmtDate(due.lastDone.date)}${due.lastDone.odometer !== undefined ? ` at ${km(due.lastDone.odometer)}` : ''}` : due.basis === 'baseline' ? 'Counting from your starting point (never logged)' : 'No starting point yet'}</div>
                  <div className="row wrap" style={{ gap: '.35rem', marginTop: '.3rem' }}><Chip kind={SRC[task.source].kind}>{SRC[task.source].label}</Chip>{task.sourceNote && <span className="small muted">{task.sourceNote}</span>}</div>
                </div>
                <div className="col no-print" style={{ alignItems: 'flex-end', gap: '.4rem' }}>
                  <DueChip status={due.status} />
                  <div className="row" style={{ gap: '.4rem' }}>
                    <button className="btn small primary" onClick={() => setComplete([task.key])}>Mark done</button>
                    <button className="btn small ghost" onClick={() => setTaskForm(task)}>Edit</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {paused.length > 0 && (
        <details className="card"><summary style={{ cursor: 'pointer' }}>{paused.length} paused reminder{paused.length > 1 ? 's' : ''}</summary>
          <div className="list" style={{ marginTop: '.5rem' }}>{paused.map(({ task }) => <div className="li" key={task.id}><span className="grow">{task.name}</span><button className="btn small" onClick={async () => { await save('tasks', { ...task, enabled: true }); bump(); }}>Resume</button></div>)}</div>
        </details>
      )}

      <section className="card col">
        <h2>Service history</h2>
        {b.services.length === 0 ? <Empty title="No services recorded">Completing a task adds a permanent history entry; earlier entries are never overwritten.</Empty> : (
          <div className="list">
            {b.services.map(s => (
              <div className="li" key={s.id} style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="t">{s.work}</div>
                  <div className="s">{fmtDate(s.date)}{s.odometer !== undefined ? ` · ${km(s.odometer)}` : ''}{s.workshop ? ` · ${s.workshop}` : ''}</div>
                  {s.parts && <div className="s">Parts: {s.parts}</div>}
                  {s.warranty && <div className="s">Warranty: {s.warranty}</div>}
                  {s.taskKeys.length > 0 && <div className="row wrap" style={{ gap: '.3rem', marginTop: '.25rem' }}>{s.taskKeys.map(k => <Chip key={k}>{b.tasks.find(t => t.key === k)?.name ?? k}</Chip>)}</div>}
                </div>
                <div className="col" style={{ alignItems: 'flex-end', gap: '.3rem' }}>
                  <strong>{inr(s.labourCost + s.partsCost)}</strong>
                  {(s.labourCost > 0 || s.partsCost > 0) && <span className="small muted">labour {inr(s.labourCost)} · parts {inr(s.partsCost)}</span>}
                  <span className="no-print"><button className="btn small ghost" onClick={() => setEditSvc(s)}>Edit</button><button className="btn small ghost danger" onClick={() => setDelSvc(s)}>Delete</button></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {complete && <ServiceForm bundle={b} presetTaskKeys={complete} onClose={() => setComplete(null)} />}
      {editSvc && <ServiceForm bundle={b} entry={editSvc} onClose={() => setEditSvc(undefined)} />}
      {taskForm && <TaskForm bundle={b} task={taskForm === 'new' ? undefined : taskForm} onClose={() => setTaskForm(null)} />}
      <Confirm open={!!delSvc} title="Delete this service record?" onCancel={() => setDelSvc(undefined)}
        onConfirm={async () => { if (delSvc) await softDelete('services', delSvc.id); setDelSvc(undefined); bump(); toast('Service deleted. Next-due dates were recalculated. Restore it from Backup & restore.'); }}
        body={<p>{delSvc && `${fmtDate(delSvc.date)} · ${delSvc.work}`}<br /><span className="muted small">Tasks it completed will count from their previous service instead. You can restore it later.</span></p>} />
    </div>
  );
}
