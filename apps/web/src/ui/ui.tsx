/* компоненты интерфейса (БЭМ) */
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { dueInfo } from '../lib/format.ts';

/* иконки */
const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3',
  building: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  check: 'M20 6 9 17l-5-5',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  table: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18',
  chart: 'M3 3v18h18M7 16v-3M12 16V8M17 16v-6',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  lecture: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  test: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  lab: 'M10 2v7.31L4.2 19.4A1.75 1.75 0 0 0 5.7 22h12.6a1.75 1.75 0 0 0 1.5-2.6L14 9.31V2M8.5 2h7M7 16h10',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  key: 'm21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  send: 'm22 2-7 20-4-9-9-4zM22 2 11 13',
  cycle: 'M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M18.5 2.5v3.7h-3.7M5.5 21.5v-3.7h3.7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.35-4.35',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  stop: 'M7 7h10v10H7z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  flag: 'M4 22V4M4 4h12l-2 4 2 4H4',
  glossary: 'M4 19V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13M8 7h7M8 11h5',
  live: 'M12 12h.01M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  expand: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  package: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  question: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
};

export const Icon = ({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[name] ?? PATHS.info} />
  </svg>
);

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'danger' | 'ghost' | 'default' | 'success';
  size?: 'sm' | 'md';
  icon?: string;
  busy?: boolean;
};

export const Button = ({ kind = 'default', size = 'md', icon, busy, children, className = '', disabled, ...rest }: BtnProps) => (
  <button
    type="button"
    className={`btn btn--${kind} ${size === 'sm' ? 'btn--sm' : ''} ${className}`}
    disabled={disabled || busy}
    aria-busy={busy || undefined}
    title={children ? undefined : rest['aria-label']}
    {...rest}
  >
    {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
    {children && <span>{children}</span>}
  </button>
);

export const Field = ({ label, hint, children, wide }: { label: string; hint?: string; children: (id: string) => ReactNode; wide?: boolean }) => {
  const id = useId();
  return (
    <div className={`field ${wide ? 'field--wide' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
};

/* модальное окно на нативном dialog: Esc и фокус работают сами */
export const Modal = ({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onCancel={(e) => (e.preventDefault(), onClose())} onClick={(e) => e.target === ref.current && onClose()}>
      {open && (
        <div className={`modal__panel ${wide ? 'modal__panel--wide' : ''}`}>
          <div className="modal__head">
            <h2 className="modal__title">{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
              <Icon name="x" />
            </button>
          </div>
          <div className="modal__body">{children}</div>
          {footer && <div className="modal__foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
};

export const Badge = ({ tone = 'muted', children }: { tone?: string; children: ReactNode }) => <span className={`badge badge--${tone}`}>{children}</span>;

export const Tabs = <T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number; icon?: string }[] }) => (
  <div className="tabs" role="tablist">
    {items.map((it) => (
      <button key={it.id} role="tab" aria-selected={value === it.id} className="tabs__tab" onClick={() => onChange(it.id)}>
        {it.icon && <Icon name={it.icon} size={18} />}
        <span>{it.label}</span>
        {it.count !== undefined && <span className="tabs__count">{it.count}</span>}
      </button>
    ))}
  </div>
);

export const PageHead = ({ title, kicker, children, back }: { title: string; kicker?: string; children?: ReactNode; back?: ReactNode }) => (
  <header className="page-head">
    <div className="page-head__text">
      {back}
      {kicker && <p className="page-head__kicker">{kicker}</p>}
      <h1 className="page-head__title">{title}</h1>
    </div>
    {children && <div className="page-head__actions">{children}</div>}
  </header>
);

export const Empty = ({ title, text, children }: { title: string; text?: string; children?: ReactNode }) => (
  <div className="empty">
    <p className="empty__title">{title}</p>
    {text && <p className="empty__text">{text}</p>}
    {children}
  </div>
);

export const Loader = () => (
  <div className="loader" role="status">
    <span className="loader__dot" />
    <span className="visually-hidden">Загрузка</span>
  </div>
);

export const ErrorBox = ({ text }: { text: string }) => (
  <div className="note note--err" role="alert">
    {text}
  </div>
);

/* загрузка данных: индикатор, ошибка или содержимое */
export const Async = <T,>({ state, children }: { state: { data?: T; error: string | null; loading: boolean }; children: (data: T) => ReactNode }) => {
  if (state.error) return <ErrorBox text={state.error} />;
  if (state.loading && state.data === undefined) return <Loader />;
  return state.data === undefined ? null : <>{children(state.data)}</>;
};

export const Stat = ({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) => (
  <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
    <span className="stat__value">{value}</span>
    <span className="stat__label">{label}</span>
  </div>
);

export const Progress = ({ value, label }: { value: number; label?: string }) => (
  <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Прогресс'}>
    <span className="progress__bar" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

/* метка срока сдачи */
export const DueBadge = ({ due }: { due: string | null | undefined }) => {
  const info = dueInfo(due);
  return info ? <Badge tone={info.tone}>{info.text}</Badge> : null;
};

/* лесенка прогресса: ступень — модуль курса, заливка — выполненная часть */
export const Stairs = ({ steps }: { steps: { title: string; done: number; total: number }[] }) => {
  const n = Math.max(steps.length, 1);
  const W = 200;
  const H = 96;
  const gap = Math.min(4, W / n / 4);
  const w = Math.max(2, (W - gap * (n - 1)) / n);
  const current = steps.findIndex((x) => x.done < x.total);
  const ready = steps.filter((x) => x.total > 0 && x.done >= x.total).length;
  return (
    <svg className="stairs" viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={`Пройдено модулей: ${ready} из ${steps.length}`}>
      {steps.map((x, i) => {
        const h = Math.round(((i + 1) / n) * H);
        const left = i * (w + gap);
        const top = H - h + 16;
        const part = x.total ? Math.min(1, x.done / x.total) : 0;
        return (
          <g key={i}>
            <title>{`${x.title}: выполнено ${x.done} из ${x.total}`}</title>
            <rect x={left + 0.75} y={top} width={w - 1.5} height={h - 0.75} className="stairs__step" />
            {part > 0 && <rect x={left + 0.75} y={top + (h - 0.75) * (1 - part)} width={w - 1.5} height={(h - 0.75) * part} className="stairs__fill" />}
            {i === current && <path d={`M${left + w / 2 - 6} ${top - 13}h12l-6 9z`} className="stairs__mark" />}
          </g>
        );
      })}
    </svg>
  );
};
