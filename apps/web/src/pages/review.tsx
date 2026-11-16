/* проверка работ и журнал успеваемости */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { checkDiagram, DIAGRAM_SPEC, type Diagram, type DiagramKind, type SubmissionStatus } from '@pc/core';
import { FileLink } from '../components/Blocks.tsx';
import { CheckResult, DiagramEditor } from '../components/Diagram.tsx';
import { useApp } from '../lib/app.tsx';
import { downloadText, fmtDateTime, SUB_STATUS } from '../lib/format.ts';
import { useAction, useLoad } from '../lib/hooks.ts';
import { Async, Badge, Button, Empty, Field, Icon, PageHead, Tabs } from '../ui/ui.tsx';

interface SubRow {
  id: string;
  version: number;
  status: SubmissionStatus;
  grade: number | null;
  late: boolean;
  createdAt: string;
  studentName: string;
  groupName: string;
  labTitle: string;
  moduleTitle: string;
  courseTitle: string;
}

type StatusTab = 'submitted' | 'returned' | 'graded' | 'all';

/* фильтры: курс и группа */
const useFilters = () => {
  const { client } = useApp();
  const courses = useLoad(() => client.call<{ id: string; title: string; status: string }[]>('GET', '/courses'), []);
  const groups = useLoad(() => client.call<{ id: string; name: string }[]>('GET', '/groups'), []);
  return { courses: courses.data ?? [], groups: groups.data ?? [] };
};

/* ---------- очередь проверки ---------- */
export const ReviewPage = () => {
  const { client } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as StatusTab) ?? 'submitted';
  const courseId = params.get('course') ?? '';
  const groupId = params.get('group') ?? '';
  const f = useFilters();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const all = useLoad(() => client.call<SubRow[]>('GET', '/submissions', undefined, { courseId, groupId }), [courseId, groupId]);
  const rows = (all.data ?? []).filter((r) => tab === 'all' || r.status === tab);
  const count = (s: SubmissionStatus) => (all.data ?? []).filter((r) => r.status === s).length;

  return (
    <>
      <PageHead title="Проверка работ" kicker="Лабораторные работы учащихся" />
      <Tabs
        value={tab}
        onChange={(v) => set('status', v === 'submitted' ? '' : v)}
        items={[
          { id: 'submitted', label: 'Ждут проверки', count: count('submitted'), icon: 'inbox' },
          { id: 'returned', label: 'На доработке', count: count('returned') },
          { id: 'graded', label: 'Оценены', count: count('graded') },
          { id: 'all', label: 'Все' },
        ]}
      />
      <div className="filters">
        <Field label="Курс">
          {(id) => (
            <select id={id} className="input" value={courseId} onChange={(e) => set('course', e.target.value)}>
              <option value="">Все курсы</option>
              {f.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Группа">
          {(id) => (
            <select id={id} className="input" value={groupId} onChange={(e) => set('group', e.target.value)}>
              <option value="">Все группы</option>
              {f.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Async state={all}>
        {() =>
          rows.length === 0 ? (
            <section className="card">
              <Empty title={tab === 'submitted' ? 'Все работы проверены' : 'Здесь пусто'} text={tab === 'submitted' ? 'Когда учащиеся сдадут работы, они появятся здесь, а вам придёт уведомление.' : undefined} />
            </section>
          ) : (
            <section className="card">
              <ul className="todo">
                {rows.map((r) => (
                  <li key={r.id} className="todo__item">
                    <Link to={`/review/${r.id}`} className="todo__link">
                      <span className="todo__icon todo__icon--lab">
                        <Icon name="lab" />
                      </span>
                      <span className="todo__body">
                        <span className="todo__title">{r.studentName}</span>
                        <span className="todo__meta">
                          {r.groupName} · {r.labTitle}
                        </span>
                      </span>
                      <span className="todo__side">
                        <span className="badges">
                          {r.status === 'graded' ? <Badge tone="ok">отметка {r.grade}</Badge> : <Badge tone={SUB_STATUS[r.status].tone}>{SUB_STATUS[r.status].label}</Badge>}
                          {r.version > 1 && <Badge>версия {r.version}</Badge>}
                          {r.late && <Badge tone="err">после срока</Badge>}
                        </span>
                        <span className="muted small">{fmtDateTime(r.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        }
      </Async>
    </>
  );
};

/* ---------- проверка одной работы ---------- */
interface FileInfo {
  id: string;
  name: string;
  size: number;
}
interface SubFull {
  id: string;
  version: number;
  status: SubmissionStatus;
  grade: number | null;
  comment: string;
  teacherComment: string;
  late: boolean;
  createdAt: string;
  studentName: string;
  groupName: string;
  lab: { id: string; title: string; goal: string; criteria: string[]; maxScore: number; diagramKind: string | null };
  module: { id: string; title: string };
  course: { id: string; title: string };
  versions: { id: string; version: number; status: SubmissionStatus; grade: number | null; comment: string; teacherComment: string; createdAt: string; late: boolean; files: FileInfo[]; diagram: Diagram | null; autoScore: number | null }[];
}

const PHRASES = ['Отличная работа!', 'Работа выполнена в полном объёме.', 'Проверьте нотацию UML.', 'Не хватает пояснений к диаграмме.', 'Оформите отчёт по требованиям.', 'Работа не соответствует варианту.'];

export const SubmissionPage = () => {
  const { id = '' } = useParams();
  const { client, user, toast } = useApp();
  const nav = useNavigate();
  const sub = useLoad(() => client.call<SubFull>('GET', `/submissions/${id}`), [id]);
  const [ver, setVer] = useState(0);
  const [grade, setGrade] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [checks, setChecks] = useState<boolean[]>([]);
  const { busy, run } = useAction();

  useEffect(() => {
    if (!sub.data) return;
    setVer(0);
    setGrade(sub.data.grade);
    setComment(sub.data.teacherComment ?? '');
    setChecks(sub.data.lab.criteria.map(() => false));
  }, [sub.data]);

  /* после оценки — следующая работа из очереди */
  const goNext = async () => {
    const queue = await client.call<SubRow[]>('GET', '/submissions', undefined, { status: 'submitted' }).catch(() => []);
    const next = queue.find((r) => r.id !== id);
    if (next) {
      toast('Открыта следующая работа из очереди', 'info');
      nav(`/review/${next.id}`);
    } else nav('/review');
  };

  return (
    <Async state={sub}>
      {(s) => {
        const v = s.versions[ver] ?? s.versions[0];
        const canGrade = user?.role !== 'methodist';
        return (
          <>
            <PageHead kicker={`${s.course.title} · ${s.module.title}`} title={s.lab.title} back={<Link to="/review" className="back"><Icon name="arrow-left" size={16} /> Проверка работ</Link>} />
            <div className="grid grid--side">
              <section className="card">
                <div className="who">
                  <span className="who__avatar" aria-hidden="true">
                    {s.studentName
                      .split(' ')
                      .slice(0, 2)
                      .map((x) => x[0])
                      .join('')}
                  </span>
                  <div>
                    <p className="who__name">{s.studentName}</p>
                    <p className="muted">Группа {s.groupName || '—'}</p>
                  </div>
                </div>

                {s.versions.length > 1 && (
                  <Tabs
                    value={String(ver)}
                    onChange={(x) => setVer(Number(x))}
                    items={s.versions.map((x, i) => ({ id: String(i), label: `Версия ${x.version}${i === 0 ? ' (последняя)' : ''}` }))}
                  />
                )}
                {v && (
                  <>
                    <p className="badges">
                      <Badge tone={SUB_STATUS[v.status].tone}>{SUB_STATUS[v.status].label}</Badge>
                      {v.late && <Badge tone="err">сдана после срока</Badge>}
                      <span className="muted">{fmtDateTime(v.createdAt)}</span>
                    </p>
                    <h2 className="card__subtitle">Файлы</h2>
                    {v.files.length ? (
                      <div className="files">
                        {v.files.map((f) => (
                          <FileLink key={f.id} id={f.id} name={f.name} />
                        ))}
                      </div>
                    ) : (
                      <p className="muted">Файлы не прикреплены</p>
                    )}
                    {v.diagram && (
                      <>
                        <h2 className="card__subtitle">{DIAGRAM_SPEC[v.diagram.kind as DiagramKind]?.title ?? 'Диаграмма'}</h2>
                        <DiagramEditor value={v.diagram} readOnly />
                        <CheckResult r={{ ...checkDiagram(v.diagram, null), score: v.autoScore, summary: v.autoScore === null ? ['Эталон для этого варианта не задан — проверена только нотация'] : [] }} />
                      </>
                    )}
                    <h2 className="card__subtitle">Комментарий учащегося</h2>
                    <p className="pre">{v.comment || <span className="muted">—</span>}</p>
                    {v.teacherComment && ver > 0 && (
                      <>
                        <h2 className="card__subtitle">Ваше замечание к этой версии</h2>
                        <p className="pre">{v.teacherComment}</p>
                      </>
                    )}
                  </>
                )}
                {s.lab.criteria.length > 0 && (
                  <>
                    <h2 className="card__subtitle">Критерии (для себя)</h2>
                    <ul className="checks">
                      {s.lab.criteria.map((c, i) => (
                        <li key={i}>
                          <label className="check">
                            <input type="checkbox" checked={checks[i] ?? false} onChange={(e) => setChecks(checks.map((x, j) => (j === i ? e.target.checked : x)))} />
                            <span>{c}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <aside className="card submit">
                <h2 className="card__title">Отметка</h2>
                {!canGrade ? (
                  <p className="muted">Методист просматривает работы, отметки ставит преподаватель.</p>
                ) : (
                  <div className="form">
                    <div className="grades" role="radiogroup" aria-label={`Отметка от 1 до ${s.lab.maxScore}`}>
                      {Array.from({ length: s.lab.maxScore }, (_, i) => i + 1).map((n) => (
                        <button key={n} type="button" role="radio" aria-checked={grade === n} className={`grades__btn ${grade === n ? 'is-on' : ''} ${n < 4 ? 'is-low' : ''}`} onClick={() => setGrade(n)}>
                          {n}
                        </button>
                      ))}
                    </div>
                    <Field label="Замечание для учащегося" hint="Видит учащийся; при возврате на доработку — обязательно">
                      {(fid) => <textarea id={fid} className="input textarea" value={comment} onChange={(e) => setComment(e.target.value)} />}
                    </Field>
                    <div className="phrases">
                      {PHRASES.map((p) => (
                        <button key={p} type="button" className="chip" onClick={() => setComment((c) => (c ? `${c} ${p}` : p))}>
                          {p}
                        </button>
                      ))}
                    </div>
                    <Button
                      kind="success"
                      icon="check"
                      className="btn--lg btn--block"
                      busy={busy}
                      disabled={!grade}
                      onClick={async () => {
                        if (await run(() => client.call('POST', `/submissions/${s.id}/grade`, { grade, comment }), `Отметка ${grade} поставлена, учащийся получит уведомление`)) await goNext();
                      }}
                    >
                      {s.status === 'graded' ? 'Изменить отметку' : grade ? `Поставить ${grade}` : 'Выберите отметку'}
                    </Button>
                    <Button
                      kind="danger"
                      icon="cycle"
                      className="btn--block"
                      busy={busy}
                      onClick={async () => {
                        if (!comment.trim()) {
                          toast('Напишите, что нужно исправить', 'err');
                          return;
                        }
                        if (await run(() => client.call('POST', `/submissions/${s.id}/return`, { comment }), 'Работа возвращена на доработку')) await goNext();
                      }}
                    >
                      Вернуть на доработку
                    </Button>
                  </div>
                )}
              </aside>
            </div>
          </>
        );
      }}
    </Async>
  );
};

/* ---------- журнал ---------- */
interface Journal {
  course: { id: string; title: string };
  group: { id: string; name: string };
  columns: { type: 'test' | 'lab'; id: string; title: string; module: string }[];
  rows: { id: string; name: string; average: number | null; cells: Record<string, { percent?: number | null; grade?: number | null; status?: string | null; late?: boolean }> }[];
}

const cellText = (c: Journal['rows'][0]['cells'][string] | undefined, type: 'test' | 'lab') => {
  if (!c) return '';
  if (type === 'test') return c.percent === null || c.percent === undefined ? '' : `${c.percent}%`;
  if (c.grade) return String(c.grade);
  if (c.status === 'submitted') return 'сдана';
  if (c.status === 'returned') return 'дораб.';
  return '';
};

export const JournalPage = () => {
  const { client } = useApp();
  const f = useFilters();
  const [params, setParams] = useSearchParams();
  const published = f.courses.filter((c) => c.status === 'published');
  const courseId = params.get('course') || published[0]?.id || '';
  const groupId = params.get('group') || f.groups[0]?.id || '';
  const j = useLoad(() => (courseId && groupId ? client.call<Journal>('GET', '/journal', undefined, { courseId, groupId }) : Promise.resolve(null)), [courseId, groupId]);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };

  const exportCsv = (d: Journal) => {
    const esc = (x: string) => `"${x.replace(/"/g, '""')}"`;
    const head = ['Учащийся', ...d.columns.map((c) => `${c.type === 'test' ? 'Тест' : 'ЛР'}: ${c.title}`), 'Средняя отметка'];
    const lines = d.rows.map((r) => [r.name, ...d.columns.map((c) => cellText(r.cells[c.id], c.type)), r.average === null ? '' : String(r.average).replace('.', ',')]);
    downloadText(`Журнал ${d.group.name} — ${d.course.title}.csv`, [head, ...lines].map((l) => l.map(esc).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  };

  return (
    <>
      <PageHead title="Журнал успеваемости" kicker="Результаты тестов и отметки за лабораторные">
        {j.data && (
          <Button icon="download" onClick={() => exportCsv(j.data!)}>
            Скачать для Excel
          </Button>
        )}
      </PageHead>
      <div className="filters">
        <Field label="Курс">
          {(id) => (
            <select id={id} className="input" value={courseId} onChange={(e) => set('course', e.target.value)}>
              {published.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Группа">
          {(id) => (
            <select id={id} className="input" value={groupId} onChange={(e) => set('group', e.target.value)}>
              {f.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Async state={j}>
        {(d) =>
          !d ? (
            <section className="card">
              <Empty title="Выберите курс и группу" text="Журнал строится по опубликованному курсу, назначенному группе." />
            </section>
          ) : d.rows.length === 0 ? (
            <section className="card">
              <Empty title="В группе нет учащихся" />
            </section>
          ) : (
            <>
              <div className="table-wrap journal">
                <table className="table journal__table">
                  <caption className="visually-hidden">
                    Журнал группы {d.group.name}, курс {d.course.title}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="journal__name">
                        Учащийся
                      </th>
                      {d.columns.map((c) => (
                        <th key={c.id} scope="col" title={`${c.module}: ${c.title}`}>
                          <span className={`journal__kind journal__kind--${c.type}`}>{c.type === 'test' ? 'Тест' : 'ЛР'}</span>
                          <span className="journal__col">{c.title.replace(/^(Тест|Лабораторная работа)\.?\s*/i, '')}</span>
                        </th>
                      ))}
                      <th scope="col">Средняя</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <th scope="row" className="journal__name">
                          {r.name}
                        </th>
                        {d.columns.map((c) => {
                          const cell = r.cells[c.id];
                          const text = cellText(cell, c.type);
                          const tone = c.type === 'lab' ? (cell?.grade ? (cell.grade >= 4 ? 'ok' : 'low') : cell?.status === 'submitted' ? 'wait' : cell?.status === 'returned' ? 'low' : '') : cell?.percent !== null && cell?.percent !== undefined ? (cell.percent >= 60 ? 'ok' : 'low') : '';
                          return (
                            <td key={c.id} className={`journal__cell ${tone ? `is-${tone}` : ''}`}>
                              {text || '·'}
                              {cell?.late && (
                                <span className="late-mark" title="сдано после срока">
                                  <Icon name="clock" size={13} />
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="journal__avg">{r.average ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="legend">
                <span className="journal__cell is-ok">9</span> оценено
                <span className="journal__cell is-wait">сдана</span> ждёт проверки
                <span className="journal__cell is-low">дораб.</span> на доработке или ниже порога
                <span className="journal__cell">·</span> ещё не сдано
                <span className="late-mark">
                  <Icon name="clock" size={13} />
                </span>
                сдано после срока
              </p>
            </>
          )
        }
      </Async>
    </>
  );
};
