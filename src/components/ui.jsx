import { useEffect, useId, useRef } from 'react';
import { X, Check, AlertCircle, Minus, Clock3, FileCheck2, Search, Wrench, Coins, Hash, CircleDashed, LoaderCircle } from 'lucide-react';
import { classNames } from '../utils.js';

export function StatusBadge({ status, children }) {
  const names = { passed: 'Passed', failed: 'Failed', review: 'Review required', blocked: 'Incomplete evidence', accepted: 'Accepted', rejected: 'Rejected', needs_work: 'Needs work', pending: 'Pending review' };
  const tone = ['passed', 'accepted'].includes(status) ? 'success' : ['failed', 'rejected'].includes(status) ? 'danger' : ['review', 'pending', 'needs_work'].includes(status) ? 'warning' : 'neutral';
  return <span className={`badge ${tone}`}>{children || names[status] || status}</span>;
}

export function MetricIcon({ id, size = 17 }) {
  const Icon = { groundedness: FileCheck2, relevance: Search, latency: Clock3, tool_success: Wrench, cost: Coins, contains: Hash }[id] || CircleDashed;
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function Modal({ title, children, onClose, className = '', drawer = false }) {
  const dialog = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const headingId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.focus();
    const keydown = event => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const elements = [...(element?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]') || [])].filter(node => node.getClientRects().length > 0);
        if (!elements.length) { event.preventDefault(); return; }
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = original; previous?.focus?.(); };
  }, []);
  return <div className={classNames('modal-backdrop', drawer && 'drawer-backdrop')} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} ref={dialog} className={classNames('modal', drawer && 'drawer', className)}>
      <header className="modal-header"><h2 id={headingId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>
      {children}
    </section>
  </div>;
}

export function EmptyState({ icon: Icon = CircleDashed, title, children, action }) {
  return <div className="empty-state"><Icon size={30} strokeWidth={1.5} /><h3>{title}</h3><p>{children}</p>{action}</div>;
}

export function Notice({ children, tone = 'info' }) {
  return <div className={classNames('callout', tone === 'warning' && 'warning', tone === 'error' && 'error')}><AlertCircle size={17} /><div>{children}</div></div>;
}

export function Toast({ message }) {
  return message ? <div className="toast" role="status"><Check size={17} />{message}</div> : null;
}

export function RunProgress({ stage, specName, onClose }) {
  const labels = ['Selecting and validating traces', 'Freezing the dataset and specification', 'Executing local scoring rules', 'Creating the review queue', 'Building the scorecard and report'];
  return <Modal title="Running evaluation" onClose={onClose} className="progress-modal"><div className="modal-body"><p className="subtext">{specName} · browser execution</p><div className="progress-track"><div style={{ width: `${(stage + 1) * 20}%` }} /></div><div className="progress-stages">{labels.map((label, i) => <div key={label} className={classNames('progress-stage', stage === i && 'active', stage > i && 'done')}>{stage > i ? <Check size={18} /> : stage === i ? <LoaderCircle className="spin" size={18} /> : <Minus size={18} />}<span>{label}</span></div>)}</div><p className="small muted">Recorded demo judgments are replayed. No external model is called.</p></div></Modal>;
}
