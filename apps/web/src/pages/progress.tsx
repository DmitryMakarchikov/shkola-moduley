/* успеваемость: обзор групп и группа подробно (куратор, преподаватель, методист, директор) */
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useApp } from '../lib/app.tsx';
import { downloadText, fmtDate, plural } from '../lib/format.ts';
import { useAction, useLoad } from '../lib/hooks.ts';
import { Async, Badge, Button, Empty, Icon, PageHead, Progress, Tabs } from '../ui/ui.tsx';

type Kind = 'lecture' | 'test' | 'lab';
interface Dist {
  excellent: number;
  good: number;
  fair: number;
  poor: number;
  none: number;
}
export interface GroupSum {
  id: string;
  name: string;
  year: number;
  specialty: string;
  curator: string;
  curated: boolean;
  students: number;
  courses: { id: string; title: string; teacher: string }[];
  average: number | null;
  progress: number;
  plan: number;
  testsAverage: number | null;
  debts: number;
  debtors: number;
  pending: number;
  risk: number;
  top: number;
  distribution: Dist;
}
interface StudentRow {
  id: string;
  name: string;
  progress: number;
  plan: number;
  average: number | null;
  testsAverage: number | null;
  graded: number;
  pending: number;
  late: number;
  debts: { kind: Kind; id: string; title: string; course: string; due: string; days: number; status: string }[];
  upcoming: { kind: Kind; id: string; title: string; course: string; due: string }[];
  lastActive: string | null;
  level: 'risk' | 'ok' | 'top';
  reasons: string[];
  courses: { id: string; progress: number; average: number | null; debts: number }[];
  telegram: boolean;
}
interface GroupDetail {
  group: GroupSum;
  students: StudentRow[];
  canRemind: boolean;
}

const num = (x: number | null) => (x === null ? '—' : String(x).replace('.', ','));
/* цвет отметки по десятибалльной шкале */
export const gradeTone = (x: number | null) => (x === null ? 'muted' : x >= 9 ? 'ok' : x >= 7 ? 'info' : x >= 5 ? 'warn' : 'err');
const KIND_LABEL: Record<Kind, string> = { lecture: 'Лекция', test: 'Тест', lab: 'ЛР' };
const ago = (iso: string | null) => {
  if (!iso) return 'не заходил';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} ${plural(d, ['день', 'дня', 'дней'])} назад`;
};

/* распределение средних отметок: полоса из пяти частей и подписи */
export const DistBar = ({ d, total }: { d: Dist; total: number }) => {
  const parts: [keyof Dist, string][] = [
    ['excellent', '9–10'],
    ['good', '7–8'],
    ['fair', '5–6'],
    ['poor', 'ниже 5'],
    ['none', 'нет отметок'],
  ];
  return (
    <div className="dist">
      <div className="dist__bar" role="img" aria-label={parts.map(([k, l]) => `${l}: ${d[k]}`).join(', ')}>
        {parts.map(([k]) => (d[k] ? <span key={k} className={`dist__part dist__part--${k}`} style={{ flexGrow: d[k] }} title={`${d[k]} ${plural(d[k], ['учащийся', 'учащихся', 'учащихся'])}`} /> : null))}
        {!total && <span className="dist__part dist__part--none" style={{ flexGrow: 1 }} />}
      </div>
      <ul className="dist__legend">
        {parts.map(([k, l]) => (
          <li key={k}>
            <i className={`dist__dot dist__part--${k}`} />
            {l}: <b>{d[k]}</b>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* кольцо прогресса */
export const Ring = ({ value, label }: { value: number; label: string }) => (
  <div className="ring" style={{ ['--p' as string]: `${value}` }} role="img" aria-label={`${label}: ${value}%`}>
    <span className="ring__value">{value}%</span>
  </div>
);

/* ---------- обзор групп ---------- */
export const ProgressPage = () => {
  const { client } = useApp();
  const list = useLoad(() => client.call<GroupSum[]>('GET', '/progress'), []);
  const [view, setView] = useState<'all' | 'mine'>('all');
  const [sort, setSort] = useState<'name' | 'average' | 'progress' | 'debts'>('name');

  return (
    <>
      <PageHead title="Успеваемость" kicker="Как идут дела у групп: прогресс по курсам, средний балл, долги и работы на проверке" />
      <Async state={list}>
        {(groups) => {
          if (!groups.length)
            return (
              <section className="card">
                <Empty title="Групп пока нет" text="Успеваемость появится, когда курс будет назначен группе. Куратор видит свою группу, преподаватель — группы, где ведёт курс." />
              </section>
            );
          const mine = groups.filter((g) => g.curated);
          const shown = (view === 'mine' ? mine : groups).slice().sort((a, b) => {
            if (sort === 'average') return (b.average ?? -1) - (a.average ?? -1);
            if (sort === 'progress') return b.plan - a.plan;
            if (sort === 'debts') return b.debts - a.debts;
            return Number(b.curated) - Number(a.curated) || a.name.localeCompare(b.name, 'ru');
          });
          const best = Math.max(...groups.map((g) => g.average ?? 0));
          return (
            <>
              <div className="toolbar">
                {mine.length > 0 && (
                  <Tabs
                    value={view}
                    onChange={setView}
                    items={[
                      { id: 'all', label: 'Все группы', count: groups.length },
                      { id: 'mine', label: 'Мои группы', count: mine.length },
                    ]}
                  />
                )}
                <label className="toolbar__sort">
                  Сортировка
                  <select className="input input--inline" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                    <option value="name">по названию</option>
                    <option value="average">по среднему баллу</option>
                    <option value="progress">по выполнению в срок</option>
                    <option value="debts">по числу долгов</option>
                  </select>
                </label>
              </div>

              {shown.length > 1 && (
                <section className="card compare" aria-label="Сравнение групп">
                  <h2 className="card__subtitle">Сравнение групп</h2>
                  <div className="compare__grid">
                    <span className="compare__head">Группа</span>
                    <span className="compare__head">Средний балл</span>
                    <span className="compare__head">Выполнено в срок</span>
                    <span className="compare__head">Долги</span>
                    {shown.map((g) => (
                      <Link key={g.id} to={`/progress/${g.id}`} className="compare__row">
                        <b>
                          {g.name}
                          {g.average !== null && g.average === best && groups.length > 1 && <span className="compare__crown"> ★</span>}
                        </b>
                        <span className="compare__bar">
                          <span className={`compare__fill compare__fill--${gradeTone(g.average)}`} style={{ width: `${((g.average ?? 0) / 10) * 100}%` }} />
                          <em>{num(g.average)}</em>
                        </span>
                        <span className="compare__bar">
                          <span className="compare__fill" style={{ width: `${g.plan}%` }} />
                          <em>{g.plan}%</em>
                        </span>
                        <span className={g.debts ? 'compare__debts' : 'muted'}>{g.debts || 'нет'}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              <div className="group-cards">
                {shown.map((g) => (
                  <Link key={g.id} to={`/progress/${g.id}`} className={`card group-card ${g.curated ? 'group-card--mine' : ''}`}>
                    <div className="group-card__head">
                      <div>
                        <h2 className="group-card__name">{g.name}</h2>
                        <p className="group-card__meta">
                          {g.year} курс · {g.students} {plural(g.students, ['учащийся', 'учащихся', 'учащихся'])}
                          {g.curator && ` · куратор ${g.curator}`}
                        </p>
                      </div>
                      {g.curated && <Badge tone="info">моя группа</Badge>}
                    </div>
                    <div className="group-card__kpi">
                      <div className="group-card__ring">
                        <Ring value={g.plan} label="Выполнено в срок" />
                        <small>в срок</small>
                      </div>
                      <div className="group-card__nums">
                        <span>
                          <b className={`tone-${gradeTone(g.average)}`}>{num(g.average)}</b> средний балл
                        </span>
                        <span>
                          <b>{g.testsAverage === null ? '—' : `${Math.round(g.testsAverage)}%`}</b> тесты · курс {g.progress}%
                        </span>
                        <span>
                          <b className={g.debts ? 'tone-err' : ''}>{g.debts}</b> {plural(g.debts, ['долг', 'долга', 'долгов'])}
                          {g.debtors > 0 && ` у ${g.debtors} уч.`}
                        </span>
                        <span>
                          <b className={g.pending ? 'tone-warn' : ''}>{g.pending}</b> на проверке
                        </span>
                      </div>
                    </div>
                    <DistBar d={g.distribution} total={g.students} />
                    <div className="group-card__foot">
                      {g.risk > 0 ? <Badge tone="err">в зоне риска: {g.risk}</Badge> : <Badge tone="ok">без риска</Badge>}
                      {g.top > 0 && <Badge tone="ok">отличники: {g.top}</Badge>}
                      <span className="group-card__open">
                        Открыть <Icon name="down" size={16} />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
};

/* ---------- группа подробно ---------- */
export const GroupProgressPage = () => {
  const { id = '' } = useParams();
  const { client, confirm, toast } = useApp();
  const data = useLoad(() => client.call<GroupDetail>('GET', `/progress/${id}`), [id]);
  const { busy, run } = useAction();
  const [filter, setFilter] = useState<'all' | 'debt' | 'risk' | 'top'>('all');
  const [sp] = useSearchParams();
  /* из поиска: ?s=фамилия — сразу отфильтровать учащегося */
  const [q, setQ] = useState(sp.get('s') ?? '');
  const [sort, setSort] = useState<'name' | 'progress' | 'average' | 'debts'>('name');
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const d = data.data;
    if (!d) return [];
    const needle = q.trim().toLowerCase();
    return d.students
      .filter((s) => (filter === 'debt' ? s.debts.length > 0 : filter === 'risk' ? s.level === 'risk' : filter === 'top' ? s.level === 'top' : true))
      .filter((s) => !needle || s.name.toLowerCase().includes(needle))
      .sort((a, b) =>
        sort === 'progress' ? b.plan - a.plan : sort === 'average' ? (b.average ?? -1) - (a.average ?? -1) : sort === 'debts' ? b.debts.length - a.debts.length : a.name.localeCompare(b.name, 'ru'),
      );
  }, [data.data, filter, q, sort]);

  const exportCsv = (d: GroupDetail) => {
    const esc = (x: string) => `"${x.replace(/"/g, '""')}"`;
    const head = ['Учащийся', 'Выполнено в срок, %', 'Пройдено курса, %', 'Средний балл', 'Тесты, %', 'Долгов', 'На проверке', 'Последняя активность', 'Состояние'];
    const lines = d.students.map((s) => [s.name, String(s.plan), String(s.progress), num(s.average), s.testsAverage === null ? '' : String(Math.round(s.testsAverage)), String(s.debts.length), String(s.pending), s.lastActive ? fmtDate(s.lastActive) : '', s.level === 'risk' ? `в зоне риска: ${s.reasons.join(', ')}` : s.level === 'top' ? 'отлично' : '']);
    downloadText(`Успеваемость ${d.group.name}.csv`, [head, ...lines].map((l) => l.map(esc).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  };

  return (
    <Async state={data}>
      {(d) => {
        const g = d.group;
        const count = { all: d.students.length, debt: d.students.filter((s) => s.debts.length).length, risk: g.risk, top: g.top };
        return (
          <>
            <PageHead title={`Успеваемость ${g.name}`} kicker={`${g.year} курс · ${g.specialty}${g.curator ? ` · куратор ${g.curator}` : ''}`} back={<Link to="/progress">← Все группы</Link>}>
              {d.canRemind && count.debt > 0 && (
                <Button
                  icon="send"
                  busy={busy}
                  onClick={async () => {
                    if (!(await confirm({ text: `Отправить напоминание ${count.debt} ${plural(count.debt, ['должнику', 'должникам', 'должникам'])}? Каждый получит уведомление на сайте и в Telegram со списком своих долгов.`, ok: 'Напомнить' }))) return;
                    const r = await run(() => client.call<{ sent: number }>('POST', `/progress/${g.id}/remind`));
                    if (r) toast(`Напоминание отправлено: ${r.sent} ${plural(r.sent, ['учащемуся', 'учащимся', 'учащимся'])}`);
                  }}
                >
                  Напомнить должникам
                </Button>
              )}
              <Button icon="download" onClick={() => exportCsv(d)}>
                Скачать для Excel
              </Button>
            </PageHead>

            <div className="kpis">
              <div className="kpi">
                <Ring value={g.plan} label="Выполнено в срок" />
                <span className="kpi__label">выполнено в срок · пройдено курса {g.progress}%</span>
              </div>
              <div className="kpi">
                <b className={`kpi__value tone-${gradeTone(g.average)}`}>{num(g.average)}</b>
                <span className="kpi__label">средний балл за лабораторные</span>
              </div>
              <div className="kpi">
                <b className="kpi__value">{g.testsAverage === null ? '—' : `${Math.round(g.testsAverage)}%`}</b>
                <span className="kpi__label">средний результат тестов</span>
              </div>
              <div className="kpi">
                <b className={`kpi__value ${g.debts ? 'tone-err' : 'tone-ok'}`}>{g.debts}</b>
                <span className="kpi__label">
                  {plural(g.debts, ['долг', 'долга', 'долгов'])} · у {g.debtors} из {g.students}
                </span>
              </div>
              <div className="kpi">
                <b className={`kpi__value ${g.pending ? 'tone-warn' : ''}`}>{g.pending}</b>
                <span className="kpi__label">ждут проверки</span>
              </div>
            </div>

            <section className="card">
              <h2 className="card__subtitle">Распределение средних отметок</h2>
              <DistBar d={g.distribution} total={g.students} />
            </section>

            <div className="toolbar">
              <Tabs
                value={filter}
                onChange={setFilter}
                items={[
                  { id: 'all', label: 'Все', count: count.all },
                  { id: 'debt', label: 'Должники', count: count.debt },
                  { id: 'risk', label: 'В зоне риска', count: count.risk },
                  { id: 'top', label: 'Отличники', count: count.top },
                ]}
              />
              <input className="input toolbar__search" type="search" placeholder="Поиск по фамилии" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск учащегося" />
              <label className="toolbar__sort">
                Сортировка
                <select className="input input--inline" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="name">по фамилии</option>
                  <option value="progress">по выполнению в срок</option>
                  <option value="average">по среднему баллу</option>
                  <option value="debts">по числу долгов</option>
                </select>
              </label>
            </div>

            {rows.length === 0 ? (
              <section className="card">
                <Empty title={filter === 'debt' ? 'Должников нет' : filter === 'risk' ? 'В зоне риска никого' : filter === 'top' ? 'Отличников пока нет' : 'Никого не нашли'} text={filter === 'all' ? 'Проверьте написание фамилии.' : 'Так держать!'} />
              </section>
            ) : (
              <div className="table-wrap">
                <table className="table progress-table">
                  <thead>
                    <tr>
                      <th>Учащийся</th>
                      <th>Выполнено в срок</th>
                      <th>Средний балл</th>
                      <th>Тесты</th>
                      <th>Долги</th>
                      <th>Активность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <StudentLine key={s.id} s={s} g={g} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted progress-help">
              Выполнено в срок — доля заданий, срок которых уже наступил и которые сданы: тест пройден не ниже порога, лабораторная сдана. Пройдено курса — доля всех
              лекций, тестов и лабораторных курса. Долг — задание, срок которого прошёл, а работа не сдана, тест не пройден
              или работа возвращена на доработку. В зоне риска — три долга и больше, средний балл ниже 5 или нет активности две недели.
            </p>
          </>
        );
      }}
    </Async>
  );
};

const StudentLine = ({ s, g, open, onToggle }: { s: StudentRow; g: GroupSum; open: boolean; onToggle: () => void }) => (
  <>
    <tr className={`progress-row ${open ? 'is-open' : ''}`}>
      <td>
        <button type="button" className="progress-row__name" onClick={onToggle} aria-expanded={open}>
          <Icon name={open ? 'up' : 'down'} size={16} />
          {s.name}
        </button>
        {s.level === 'risk' && <Badge tone="err">в зоне риска</Badge>}
        {s.level === 'top' && <Badge tone="ok">отлично</Badge>}
        {s.telegram && (
          <span className="progress-row__tg" title="Получает уведомления в Telegram">
            <Icon name="send" size={14} />
          </span>
        )}
      </td>
      <td className="progress-row__bar">
        <Progress value={s.plan} label={`Выполнено в срок: ${s.name}`} />
        <span title={`Пройдено курса: ${s.progress}%`}>{s.plan}%</span>
      </td>
      <td>
        <Badge tone={gradeTone(s.average)}>{num(s.average)}</Badge>
      </td>
      <td>{s.testsAverage === null ? '—' : `${Math.round(s.testsAverage)}%`}</td>
      <td>{s.debts.length ? <b className="tone-err">{s.debts.length}</b> : <span className="muted">нет</span>}</td>
      <td className="muted">{ago(s.lastActive)}</td>
    </tr>
    {open && (
      <tr className="progress-detail">
        <td colSpan={6}>
          {s.reasons.length > 0 && (
            <p className="progress-detail__why">
              <Icon name="flag" size={16} /> Почему в зоне риска: {s.reasons.join(', ')}
            </p>
          )}
          <div className="progress-detail__cols">
            <div>
              <h3>Долги</h3>
              {s.debts.length ? (
                <ul className="debt-list">
                  {s.debts.map((x) => (
                    <li key={x.id}>
                      <Badge tone="err">{KIND_LABEL[x.kind]}</Badge> <b>{x.title}</b>
                      <span className="muted">
                        {' '}
                        — срок {fmtDate(x.due)}, просрочено на {x.days} {plural(x.days, ['день', 'дня', 'дней'])} · {x.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Долгов нет.</p>
              )}
            </div>
            <div>
              <h3>Ближайшие сроки</h3>
              {s.upcoming.length ? (
                <ul className="debt-list">
                  {s.upcoming.map((x) => (
                    <li key={x.id}>
                      <Badge tone="warn">{KIND_LABEL[x.kind]}</Badge> {x.title} <span className="muted">— до {fmtDate(x.due)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">В ближайшие три дня сроков нет.</p>
              )}
            </div>
            <div>
              <h3>По курсам</h3>
              <ul className="debt-list">
                {g.courses.map((c) => {
                  const x = s.courses.find((y) => y.id === c.id);
                  return (
                    <li key={c.id}>
                      <Link to={`/journal?course=${c.id}&group=${g.id}`}>{c.title}</Link>
                      <span className="muted">
                        {' '}
                        — {x?.progress ?? 0}%, средний {num(x?.average ?? null)}
                        {x?.debts ? `, долгов ${x.debts}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </td>
      </tr>
    )}
  </>
);
