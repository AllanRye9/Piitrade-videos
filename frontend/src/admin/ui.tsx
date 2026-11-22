import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, Search, X } from 'lucide-react';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export const inputCls =
  'w-full bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none placeholder:text-white/30 focus:border-brand-orange/70 focus:ring-1 focus:ring-brand-orange/40 disabled:opacity-50 [color-scheme:dark]';

const selectCls =
  'bg-white/5 border border-white/10 text-white text-sm rounded-lg pl-3 pr-8 py-2 outline-none focus:border-brand-orange/70 focus:ring-1 focus:ring-brand-orange/40 [color-scheme:dark]';

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-orange text-white hover:brightness-110',
  secondary: 'bg-white/10 text-white hover:bg-white/15',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  ghost: 'text-white/70 hover:bg-white/10 hover:text-white',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3.5 py-2',
        VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/** Small square icon-only button for table rows. */
export function IconButton({ label, danger, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'p-1.5 rounded-md disabled:opacity-40',
        danger ? 'text-red-400 hover:bg-red-500/15' : 'text-white/60 hover:bg-white/10 hover:text-white',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Layout bits ----------
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('bg-neutral-900 border border-white/10 rounded-xl', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-white text-xl font-bold">{title}</h1>
        {subtitle && <p className="text-white/50 text-sm mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 mb-4">{children}</div>;
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative basis-full sm:basis-auto sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(inputCls, 'pl-9')} aria-label={placeholder} />
    </div>
  );
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(selectCls, className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-white/70 text-xs font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="block text-white/35 text-[11px] mt-1">{hint}</span>}
    </label>
  );
}

/**
 * Desktop: a normal table. Phones (<768px): every row becomes a card whose cells
 * are "LABEL … value" lines, so nothing is hidden off-screen behind a horizontal
 * scroll (the row actions in particular). Labels come from the <th> text.
 */
export function Table({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    const heads = Array.from(t.querySelectorAll('thead th')).map((h) => (h.textContent || '').trim());
    t.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        const label = heads[i] && heads[i] !== 'Actions' && i !== 0 ? heads[i] : '';
        td.setAttribute('data-label', label);
        td.classList.toggle('is-actions', heads[i] === 'Actions');
      });
    });
  });
  return (
    <Card className="overflow-hidden">
      <div className="xl:overflow-x-auto">
        <table ref={ref} className="admin-table w-full text-sm text-left">
          {children}
        </table>
      </div>
    </Card>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cx('px-3 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-white/45 bg-white/[0.03] whitespace-nowrap', className)}>{children}</th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td
    className={cx(
      'px-3 py-3 text-white/85 align-middle border-t border-white/5',
      'max-xl:flex max-xl:items-center max-xl:justify-between max-xl:gap-4 max-xl:border-t-0 max-xl:py-1.5 max-xl:text-right',
      'max-xl:before:content-[attr(data-label)] max-xl:before:text-[11px] max-xl:before:uppercase max-xl:before:tracking-wide max-xl:before:text-white/40 max-xl:before:text-left max-xl:before:shrink-0',
      'max-xl:[&.is-actions]:justify-end max-xl:[&.is-actions]:pt-2 max-xl:max-w-none max-xl:[&:first-child]:justify-start max-xl:[&:first-child]:text-left max-xl:[&:first-child]:pt-3',
      className
    )}
  >
    {children}
  </td>
);

const TONES = {
  neutral: 'bg-white/10 text-white/70',
  green: 'bg-emerald-500/15 text-emerald-300',
  red: 'bg-red-500/15 text-red-300',
  amber: 'bg-amber-500/15 text-amber-300',
  orange: 'bg-brand-orange/20 text-brand-amber',
  blue: 'bg-sky-500/15 text-sky-300',
};
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', TONES[tone])}>{children}</span>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-white/50 text-sm">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-14 px-4">
      <p className="text-white/80 font-semibold">{title}</p>
      {hint && <p className="text-white/45 text-sm mt-1">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="text-center py-12 px-4">
      <AlertTriangle className="mx-auto text-red-400 mb-2" size={22} />
      <p className="text-red-300 text-sm">{message}</p>
      {onRetry && (
        <Button className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Pagination({ page, pages, total, limit, onChange }: { page: number; pages: number; total: number; limit: number; onChange: (p: number) => void }) {
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between gap-3 mt-3 text-sm text-white/55">
      <span>
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={18} />
        </IconButton>
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        <IconButton label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight size={18} />
        </IconButton>
      </div>
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, size = 'md' }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('w-full bg-neutral-900 border border-white/10 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92dvh]', width)}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
          <h2 className="text-white font-semibold truncate">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-white/10 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={go}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-white/75 text-sm">{message}</div>
      {children}
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
    </Modal>
  );
}

/** Standard create/edit form shell: handles submit, busy state and error display. */
export function FormModal({
  title,
  submitLabel = 'Save',
  onSubmit,
  onClose,
  children,
  size = 'md',
}: {
  title: string;
  submitLabel?: string;
  onSubmit: () => Promise<void>;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      size={size}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} type="submit" form="admin-form">
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="admin-form" onSubmit={submit} className="space-y-4">
        {children}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </form>
    </Modal>
  );
}

// ---------- Toasts ----------
interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 items-end pointer-events-none" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-center gap-2 bg-neutral-800 border border-white/10 text-white text-sm rounded-lg px-3.5 py-2.5 shadow-xl max-w-sm">
            {t.tone === 'success' ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : t.tone === 'error' ? <AlertTriangle size={16} className="text-red-400 shrink-0" /> : <Info size={16} className="text-sky-400 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- formatting ----------
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
/** Tolerates a missing value (an older API, a field not yet populated) — a number formatter must never take the page down. */
export const fmtNum = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : 0).toLocaleString();

/**
 * Catches a rendering error in one page so the rest of the dashboard (sidebar, navigation, sign-out)
 * keeps working, instead of the whole admin going blank.
 */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Admin page crashed', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-md mx-auto text-center py-20">
        <AlertTriangle className="mx-auto text-red-400 mb-3" size={30} />
        <h1 className="text-white font-semibold text-lg">This page hit a problem</h1>
        <p className="text-white/50 text-sm mt-1">The rest of the dashboard still works. Try again, or open another section.</p>
        <Button className="mt-4" onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    );
  }
}
