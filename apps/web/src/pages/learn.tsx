/* обучение: мои курсы, курс по модулям, лекция, тест, лабораторная */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { DIAGRAM_SPEC, findRanges, queryWords, type Block, type Diagram, type DiagramCheck, type DiagramKind, type QuestionType, type SubmissionStatus, type TestSettings } from '@pc/core';
import { Blocks, FileLink } from '../components/Blocks.tsx';
import { CheckResult, DiagramEditor, emptyDiagram } from '../components/Diagram.tsx';
import { useApp } from '../lib/app.tsx';
import { fileSize, fmtDate, fmtDateTime, itemLink, KIND_ICON, KIND_LABEL, plural, SUB_STATUS, type ItemKind } from '../lib/format.ts';
import { useAction, useLoad } from '../lib/hooks.ts';
import { Async, Badge, Button, DueBadge, Empty, Field, Icon, PageHead, Progress } from '../ui/ui.tsx';

/* ---------- данные ---------- */
interface Prog {
  lectures: number;
  lecturesDone: number;
  tests: number;
  testsDone: number;
  labs: number;
  labsDone: number;
  percent: number;
}
interface Step {
  kind: ItemKind;
  id: string;
  title: string;
  module: string;
}
interface ModView {
  id: string;
  title: string;
  goal: string;
  tasks: string[];
  outcomes: string[];
  hours: number;
  lectures: { id: string; title: string; viewed: boolean }[];
  tests: { id: string; title: string; best: number | null; passed: boolean; attempts: number; limit: number; due: string | null }[];
  labs: { id: string; title: string; status: SubmissionStatus | null; grade: number | null; due: string | null }[];
  /* модуль закрыт, пока не пересдан тест предыдущего модуля */
  locked: { testId: string; title: string; pass: number; module: string } | null;
}
interface CourseView {
  id: string;
  title: string;
  description: string;
  preview: boolean;
  sections: { id: string; title: string; modules: ModView[] }[];
  progress: Prog;
  nextDue: { title: string; due: string } | null;
}
interface Ref {
  id: string;
  title: string;
}

/* порядок прохождения: лекции → тесты → лабораторные внутри модуля */
const flatten = (c: CourseView) => {
  const out: (Step & { done: boolean })[] = [];
  for (const s of c.sections) {
    for (const m of s.modules) {
      for (const l of m.lectures) out.push({ kind: 'lecture', id: l.id, title: l.title, module: m.title, done: l.viewed });
      for (const t of m.tests) out.push({ kind: 'test', id: t.id, title: t.title, module: m.title, done: t.passed });
      for (const b of m.labs) out.push({ kind: 'lab', id: b.id, title: b.title, module: m.title, done: b.status === 'graded' });
    }
  }
  return out;
};

/* навигация «назад / дальше» по курсу */
const Pager = ({ courseId, id }: { courseId: string; id: string }) => {
  const { client } = useApp();
  const course = useLoad(() => client.call<CourseView>('GET', `/learn/courses/${courseId}`), [courseId, id]);
  if (!course.data) return null;
  const items = flatten(course.data);
  const i = items.findIndex((x) => x.id === id);
  const prev = items[i - 1];
  const next = items[i + 1];
  return (
    <nav className="pager" aria-label="Навигация по курсу">
      {prev ? (
        <Link to={itemLink(prev.kind, prev.id)} className="pager__link">
          <span className="pager__dir">
            <Icon name="arrow-left" size={14} /> Назад
          </span>
          <span className="pager__title">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={itemLink(next.kind, next.id)} className="pager__link pager__link--next">
          <span className="pager__dir">
            Дальше: {KIND_LABEL[next.kind].toLowerCase()} <Icon name="arrow-right" size={14} />
          </span>
          <span className="pager__title">{next.title}</span>
        </Link>
      ) : (
        <Link to={`/learn/${courseId}`} className="pager__link pager__link--next">
          <span className="pager__dir">
            Это последний шаг <Icon name="arrow-right" size={14} />
          </span>
          <span className="pager__title">Вернуться к курсу</span>
        </Link>
      )}
    </nav>
  );
};

const Crumbs = ({ course, module }: { course: Ref; module: Ref }) => (
  <nav className="crumbs" aria-label="Путь">
    <Link to={`/learn/${course.id}`}>{course.title}</Link>
    <span aria-hidden="true">›</span>
    <span>{module.title}</span>
  </nav>
);

const PreviewNote = () => <div className="note note--info">Режим просмотра: так материал видит учащийся. Ваши ответы и отметки не сохраняются.</div>;

/* ---------- мои курсы ---------- */
export const MyCoursesPage = () => {
  const { client } = useApp();
  const list = useLoad(() => client.call<{ id: string; title: string; description: string; progress: Prog; next: Step | null }[]>('GET', '/learn/courses'), []);
  return (
    <>
      <PageHead title="Мои курсы" />
      <Async state={list}>
        {(rows) =>
          rows.length === 0 ? (
            <section className="card">
              <Empty title="Курсов пока нет" text="Курс появится, когда преподаватель назначит его вашей группе." />
            </section>
          ) : (
            <div className="cards">
              {rows.map((c) => (
                <article key={c.id} className="tile tile--course">
                  <Link to={`/learn/${c.id}`} className="tile__link">
                    <span className="tile__title">{c.title}</span>
                    {c.description && <span className="tile__text">{c.description}</span>}
                  </Link>
                  <div className="tile__progress">
                    <Progress value={c.progress.percent} label="Пройдено" />
                    <span>{c.progress.percent}%</span>
                  </div>
                  <span className="tile__meta">
                    Лекции {c.progress.lecturesDone}/{c.progress.lectures} · тесты {c.progress.testsDone}/{c.progress.tests} · лабораторные {c.progress.labsDone}/{c.progress.labs}
                  </span>
                  <div className="tile__actions">
                    <Link to={c.next ? itemLink(c.next.kind, c.next.id) : `/learn/${c.id}`} className="btn btn--primary btn--sm">
                      {c.next ? 'Продолжить' : 'Открыть'}
                    </Link>
                    <Link to={`/learn/${c.id}`} className="btn btn--sm">
                      Содержание
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )
        }
      </Async>
    </>
  );
};

/* ---------- курс ---------- */
const ItemStatus = ({ kind, item }: { kind: ItemKind; item: ModView['lectures'][0] | ModView['tests'][0] | ModView['labs'][0] }) => {
  if (kind === 'lecture') return (item as ModView['lectures'][0]).viewed ? <Badge tone="ok">прочитано</Badge> : <Badge>не прочитано</Badge>;
  if (kind === 'test') {
    const t = item as ModView['tests'][0];
    if (t.passed) return <Badge tone="ok">сдан · {t.best}%</Badge>;
    if (t.best !== null) return <Badge tone="warn">{t.best}% · не сдан</Badge>;
    return <Badge>не начат</Badge>;
  }
  const l = item as ModView['labs'][0];
  if (l.status === 'graded') return <Badge tone="ok">отметка {l.grade}</Badge>;
  if (l.status) return <Badge tone={SUB_STATUS[l.status].tone}>{SUB_STATUS[l.status].label.toLowerCase()}</Badge>;
  return <Badge>не сдана</Badge>;
};

export const LearnCoursePage = () => {
  const { courseId = '' } = useParams();
  const { client } = useApp();
  const course = useLoad(() => client.call<CourseView>('GET', `/learn/courses/${courseId}`), [courseId]);
  /* переход к теме из поиска: ?m=модуль — раздел раскрыт, тема подсвечена */
  const [sp] = useSearchParams();
  const focus = sp.get('m');
  useEffect(() => {
    if (!focus || !course.data) return;
    const t = setTimeout(() => document.getElementById(`m-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    return () => clearTimeout(t);
  }, [focus, course.data]);

  return (
    <Async state={course}>
      {(c) => {
        const flat = flatten(c);
        const next = flat.find((x) => !x.done);
        let n = 0;
        return (
          <>
            <PageHead kicker="Курс" title={c.title} back={<Link to="/learn" className="back"><Icon name="arrow-left" size={16} /> Мои курсы</Link>} />
            {c.preview && <PreviewNote />}
            <section className="course-sum card">
              <div className="course-sum__main">
                {c.description && <p className="muted">{c.description}</p>}
                <div className="course-sum__bar">
                  <Progress value={c.progress.percent} label="Пройдено" />
                  <strong>{c.progress.percent}%</strong>
                </div>
                <p className="course-sum__counts">
                  <span>
                    <Icon name="lecture" size={16} /> лекции {c.progress.lecturesDone} из {c.progress.lectures}
                  </span>
                  <span>
                    <Icon name="test" size={16} /> тесты {c.progress.testsDone} из {c.progress.tests}
                  </span>
                  <span>
                    <Icon name="lab" size={16} /> лабораторные {c.progress.labsDone} из {c.progress.labs}
                  </span>
                </p>
              </div>
              <div className="course-sum__side">
                {next && (
                  <Link to={itemLink(next.kind, next.id)} className="btn btn--primary btn--lg">
                    {flat.some((x) => x.done) ? 'Продолжить' : 'Начать'}: {KIND_LABEL[next.kind].toLowerCase()}
                  </Link>
                )}
                <Link to={`/learn/${c.id}/glossary`} className="btn">
                  <Icon name="glossary" size={18} /> Словарь терминов курса
                </Link>
              </div>
            </section>

            {c.sections.map((s) => {
              const own = flat.filter((x) => s.modules.some((m) => m.title === x.module));
              const doneHere = own.filter((x) => x.done).length;
              const hasNext = !!next && s.modules.some((m) => m.title === next.module);
              return (
              <details key={s.id} className="sec" open={c.sections.length === 1 || hasNext || s.modules.some((m) => m.id === focus)}>
                <summary className="sec__head">
                  <span className="sec__title">{s.title}</span>
                  <span className="sec__meta">
                    {s.modules.length} {plural(s.modules.length, ['тема', 'темы', 'тем'])} · выполнено {doneHere} из {own.length}
                  </span>
                  <Progress value={own.length ? (doneHere / own.length) * 100 : 0} label={`Раздел: выполнено ${doneHere} из ${own.length}`} />
                </summary>
                <ol className="modules">
                  {s.modules.map((m) => {
                    n += 1;
                    const items: { kind: ItemKind; item: ModView['lectures'][0] | ModView['tests'][0] | ModView['labs'][0]; due?: string | null }[] = [
                      ...m.lectures.map((item) => ({ kind: 'lecture' as const, item })),
                      ...m.tests.map((item) => ({ kind: 'test' as const, item, due: item.due })),
                      ...m.labs.map((item) => ({ kind: 'lab' as const, item, due: item.due })),
                    ];
                    const done = flat.filter((x) => x.module === m.title && x.done).length;
                    return (
                      <li key={m.id} id={`m-${m.id}`} className={`module card ${m.locked ? 'module--locked' : ''} ${m.id === focus ? 'is-focus' : ''}`}>
                        <header className="module__head">
                          <span className="module__num">{n}</span>
                          <div className="module__titles">
                            <h3 className="module__title">{m.title}</h3>
                            <span className="module__meta">
                              выполнено {done} из {items.length} · {m.hours} {plural(m.hours, ['час', 'часа', 'часов'])}
                            </span>
                          </div>
                        </header>
                        {m.locked && (
                          <p className="module__lock">
                            <Icon name="lock" size={16} /> Откроется, когда тест «{m.locked.title}» будет сдан не ниже чем на {m.locked.pass} %.{' '}
                            <Link to={itemLink('test', m.locked.testId)}>Пересдать тест</Link>
                          </p>
                        )}
                        {(m.goal || m.outcomes.length > 0) && (
                          <details className="module__about">
                            <summary>Цель и результаты обучения</summary>
                            {m.goal && <p>{m.goal}</p>}
                            {m.outcomes.length > 0 && (
                              <ul className="outcomes">
                                {m.outcomes.map((o, i) => (
                                  <li key={i}>{o}</li>
                                ))}
                              </ul>
                            )}
                          </details>
                        )}
                        <ul className="steps">
                          {items.map(({ kind, item, due }) => (
                            <li key={item.id}>
                              <Link to={m.locked ? itemLink('test', m.locked.testId) : itemLink(kind, item.id)} className={`steps__link ${next?.id === item.id ? 'is-next' : ''} ${m.locked ? 'is-locked' : ''}`} aria-disabled={m.locked ? true : undefined}>
                                <span className={`todo__icon todo__icon--${kind}`}>
                                  <Icon name={KIND_ICON[kind]} />
                                </span>
                                <span className="steps__body">
                                  <span className="steps__kind">{KIND_LABEL[kind]}</span>
                                  <span className="steps__title">{item.title}</span>
                                </span>
                                <span className="steps__side">
                                  <ItemStatus kind={kind} item={item} />
                                  {due && <DueBadge due={due} />}
                                </span>
                              </Link>
                            </li>
                          ))}
                          {items.length === 0 && <li className="muted">Материалы модуля готовятся</li>}
                        </ul>
                      </li>
                    );
                  })}
                </ol>
              </details>
              );
            })}
          </>
        );
      }}
    </Async>
  );
};

/* ---------- лекция ---------- */
interface LectureView {
  id: string;
  title: string;
  blocks: Block[];
  viewed: boolean;
  module: Ref & { goal?: string };
  course: Ref;
}

/* полоса прогресса чтения под шапкой */
const ReadProgress = () => {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      setP(max > 0 ? Math.min(100, (scrollY / max) * 100) : 0);
    };
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  return <div className="read-bar" style={{ width: `${p}%` }} aria-hidden="true" />;
};

/* содержание лекции: разделы по заголовкам, текущий подсвечен */
const Outline = ({ heads }: { heads: { i: number; text: string }[] }) => {
  const [active, setActive] = useState(heads[0]?.i ?? 0);
  useEffect(() => {
    const on = () => {
      let cur = heads[0]?.i ?? 0;
      for (const h of heads) {
        const el = document.getElementById(`h-${h.i}`);
        if (el && el.getBoundingClientRect().top < 140) cur = h.i;
      }
      setActive(cur);
    };
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, [heads]);
  return (
    <nav className="outline" aria-label="Содержание лекции">
      <p className="outline__title">Содержание</p>
      <ol className="outline__list">
        {heads.map((h) => (
          <li key={h.i}>
            <button type="button" className={`outline__link ${active === h.i ? 'is-active' : ''}`} onClick={() => document.getElementById(`h-${h.i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {h.text}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
};

export type Term = { term: string; definition: string };
const mix = <T,>(arr: T[]) => arr.map((x) => [Math.random(), x] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

/* карточки терминов: нажатие переворачивает */
export const TermCards = ({ terms }: { terms: Term[] }) => {
  const [open, setOpen] = useState<number[]>([]);
  return (
    <ul className="cards-flip">
      {terms.map((t, i) => {
        const on = open.includes(i);
        return (
          <li key={i}>
            <button type="button" className={`flip ${on ? 'is-open' : ''}`} aria-pressed={on} onClick={() => setOpen(on ? open.filter((x) => x !== i) : [...open, i])}>
              <span className="flip__face flip__face--front">
                <span className="flip__term">{t.term}</span>
                <span className="flip__hint">нажмите, чтобы увидеть определение</span>
              </span>
              <span className="flip__face flip__face--back">{t.definition}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/* тренажёр: по определению выбрать термин; собирается из терминов лекции.
   pool — откуда брать неверные варианты (по умолчанию — те же термины) */
export const TermQuiz = ({ terms, pool = terms }: { terms: Term[]; pool?: Term[] }) => {
  const make = () =>
    mix(terms)
      .slice(0, Math.min(6, terms.length))
      .map((t) => ({ t, options: mix([t, ...mix(pool.filter((x) => x.term !== t.term)).slice(0, 3)]) }));
  const [qs, setQs] = useState(make);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const q = qs[i];
  if (!q) {
    return (
      <div className="drill drill--done">
        <p className="drill__score">
          {score} из {qs.length}
        </p>
        <p>{score === qs.length ? 'Все термины усвоены.' : score >= qs.length / 2 ? 'Неплохо. Повторите термины, в которых ошиблись.' : 'Стоит вернуться к карточкам и перечитать определения.'}</p>
        <Button
          icon="cycle"
          onClick={() => {
            setQs(make());
            setI(0);
            setScore(0);
            setPicked(null);
          }}
        >
          Пройти ещё раз
        </Button>
      </div>
    );
  }
  return (
    <div className="drill">
      <p className="drill__n">
        Вопрос {i + 1} из {qs.length}
      </p>
      <p className="drill__def">{q.t.definition}</p>
      <p className="muted">О каком термине идёт речь?</p>
      <div className="drill__opts">
        {q.options.map((o) => {
          const state = picked === null ? '' : o.term === q.t.term ? 'is-ok' : o.term === picked ? 'is-bad' : '';
          return (
            <button
              key={o.term}
              type="button"
              className={`drill__opt ${state}`}
              disabled={picked !== null}
              onClick={() => {
                setPicked(o.term);
                if (o.term === q.t.term) setScore((x) => x + 1);
              }}
            >
              {o.term}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="drill__next">
          <span className={picked === q.t.term ? 'drill__ok' : 'drill__bad'}>{picked === q.t.term ? 'Верно' : `Неверно. Правильный ответ: ${q.t.term}`}</span>
          <Button
            kind="primary"
            onClick={() => {
              setPicked(null);
              setI(i + 1);
            }}
          >
            {i + 1 < qs.length ? 'Следующий вопрос' : 'Результат'}
          </Button>
        </div>
      )}
    </div>
  );
};

/* термины одного шага (без повторов) */
const stepTerms = (blocks: Block[]): Term[] =>
  blocks.flatMap((b) => (b.type === 'term' ? [{ term: b.term, definition: b.definition }] : [])).filter((t, i, all) => all.findIndex((x) => x.term === t.term) === i);

/* текст шага для озвучивания: заголовки, абзацы, списки, термины */
const speakable = (blocks: Block[]) =>
  blocks
    .map((b) => {
      if (b.type === 'heading' || b.type === 'text' || b.type === 'note') return b.text;
      if (b.type === 'list') return b.items.join('. ');
      if (b.type === 'term') return `${b.term} — ${b.definition}`;
      return '';
    })
    .filter(Boolean)
    .join('. ')
    .replace(/\*\*/g, '');

/* «Слушать»: синтез речи браузера, работает и без интернета */
const Listen = ({ text }: { text: string }) => {
  const can = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [on, setOn] = useState(false);
  useEffect(
    () => () => {
      if (can) speechSynthesis.cancel();
      setOn(false);
    },
    [text, can],
  );
  if (!can || !text) return null;
  const toggle = () => {
    speechSynthesis.cancel();
    if (on) {
      setOn(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    const ru = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('ru'));
    if (ru) u.voice = ru;
    u.onend = () => setOn(false);
    u.onerror = () => setOn(false);
    speechSynthesis.speak(u);
    setOn(true);
  };
  return (
    <Button icon={on ? 'stop' : 'volume'} aria-pressed={on} onClick={toggle} title="Озвучить шаг голосом браузера">
      {on ? 'Остановить' : 'Слушать'}
    </Button>
  );
};

/* лекция по шагам: раздел — шаг, в конце термины и итог */
const Steps = ({ lecture, onDone, canMark, busy }: { lecture: LectureView; onDone: () => void; canMark: boolean; busy: boolean }) => {
  const parts = useMemo(() => {
    const out: { title: string; blocks: Block[] }[] = [];
    for (const b of lecture.blocks) {
      if (b.type === 'heading') out.push({ title: b.text, blocks: [] });
      else if (out.length) out[out.length - 1]!.blocks.push(b);
      else out.push({ title: 'Основные понятия', blocks: [b] });
    }
    return out.filter((x) => x.blocks.length);
  }, [lecture.blocks]);
  const terms = useMemo(() => lecture.blocks.flatMap((b) => (b.type === 'term' ? [{ term: b.term, definition: b.definition }] : [])).filter((t, i, all) => all.findIndex((x) => x.term === t.term) === i), [lecture.blocks]);
  const extra = terms.length >= 4 ? 1 : 0;
  const total = parts.length + extra + 1;
  const key = `pc.step.${lecture.id}`;
  const [step, setStep] = useState(() => {
    try {
      return Math.min(total - 1, Number(sessionStorage.getItem(key) ?? 0) || 0);
    } catch {
      return 0;
    }
  });
  const go = (n: number) => {
    const next = Math.max(0, Math.min(total - 1, n));
    setStep(next);
    try {
      sessionStorage.setItem(key, String(next));
    } catch {
      /* нет доступа к хранилищу */
    }
    document.getElementById('steps-top')?.scrollIntoView({ block: 'start' });
  };
  /* стрелки на клавиатуре листают шаги */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
      if (e.key === 'ArrowRight') go(step + 1);
      if (e.key === 'ArrowLeft') go(step - 1);
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });

  const part = parts[step];
  const isTerms = extra === 1 && step === parts.length;
  const isEnd = step === total - 1;
  return (
    <div className="steps-view" id="steps-top">
      <ol className="stepper" aria-label="Шаги лекции">
        {Array.from({ length: total }, (_, i) => (
          <li key={i}>
            <button
              type="button"
              className={`stepper__dot ${i === step ? 'is-current' : i < step ? 'is-done' : ''}`}
              aria-label={`Шаг ${i + 1}: ${parts[i]?.title ?? (extra && i === parts.length ? 'Термины' : 'Итог')}`}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => go(i)}
            />
          </li>
        ))}
      </ol>
      <article className="card step">
        <div className="step__top">
          <p className="step__n">
            Шаг {step + 1} из {total}
          </p>
          {part && <Listen text={speakable([{ type: 'heading', text: part.title }, ...part.blocks])} />}
        </div>
        {part && (
          <>
            <h2 className="step__title">{part.title}</h2>
            <Blocks blocks={part.blocks} />
            {/* проверка сразу после объяснения: термины этого шага */}
            {stepTerms(part.blocks).length >= 2 && terms.length >= 3 && (
              <section className="step__check">
                <h3 className="step__sub">Проверьте себя</h3>
                <TermQuiz key={step} terms={stepTerms(part.blocks)} pool={terms} />
              </section>
            )}
          </>
        )}
        {isTerms && (
          <>
            <h2 className="step__title">Термины лекции</h2>
            <p className="muted">Сначала переверните карточки и повторите определения, затем проверьте себя в тренажёре.</p>
            <TermCards terms={terms} />
            <h3 className="step__sub">Тренажёр: узнайте термин по определению</h3>
            <TermQuiz terms={terms} />
          </>
        )}
        {isEnd && (
          <>
            <h2 className="step__title">Итог</h2>
            <p>Вы прошли лекцию «{lecture.title}». В ней было:</p>
            <ul className="outcomes">
              {parts.slice(0, 12).map((x, i) => (
                <li key={i}>{x.title}</li>
              ))}
            </ul>
            {lecture.viewed ? (
              <p className="done-bar__ok">
                <Icon name="check" /> Лекция отмечена как прочитанная
              </p>
            ) : canMark ? (
              <Button kind="success" icon="check" className="btn--lg" busy={busy} onClick={onDone}>
                Отметить как прочитанную
              </Button>
            ) : null}
          </>
        )}
      </article>
      <div className="step-nav">
        <Button icon="arrow-left" disabled={step === 0} onClick={() => go(step - 1)}>
          Назад
        </Button>
        <span className="step-nav__hint">клавиши ← → листают шаги</span>
        {!isEnd && (
          <Button kind="primary" onClick={() => go(step + 1)}>
            <span>Дальше</span>
            <Icon name="arrow-right" size={18} />
          </Button>
        )}
      </div>
    </div>
  );
};

/* найденное поиском: подсветка в тексте лекции и переход по совпадениям.
   Подсветка через CSS Custom Highlight API — разметку React не трогаем */
type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
const registry = (): HighlightRegistry | null => (typeof CSS !== 'undefined' && 'highlights' in CSS ? (CSS as unknown as { highlights: HighlightRegistry }).highlights : null);
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

const FindBar = ({ q, root, dep, onClose }: { q: string; root: React.RefObject<HTMLElement | null>; dep: unknown; onClose: () => void }) => {
  const words = useMemo(() => queryWords(q), [q]);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [cur, setCur] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      const el = root.current;
      if (!el) return;
      const list: Range[] = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        for (const [a, b] of findRanges(n.nodeValue ?? '', words)) {
          const r = document.createRange();
          r.setStart(n, a);
          r.setEnd(n, b);
          list.push(r);
        }
      }
      setRanges(list);
      setCur(0);
    }, 80);
    return () => clearTimeout(t);
  }, [words, root, dep]);
  useEffect(() => {
    const reg = registry();
    if (reg && HighlightCtor) {
      reg.set('search', new HighlightCtor(...ranges));
      if (ranges[cur]) reg.set('search-current', new HighlightCtor(ranges[cur]));
    }
    const r = ranges[cur];
    if (r) window.scrollTo({ top: scrollY + r.getBoundingClientRect().top - innerHeight / 3, behavior: 'smooth' });
  }, [ranges, cur]);
  useEffect(
    () => () => {
      registry()?.delete('search');
      registry()?.delete('search-current');
    },
    [],
  );
  if (!words.length) return null;
  const n = ranges.length;
  return (
    <div className="findbar" role="status">
      <Icon name="search" size={16} />
      <span className="findbar__text">
        {n ? (
          <>
            «{q}»: совпадение <strong>{cur + 1}</strong> из {n}
          </>
        ) : (
          <>«{q}»: в тексте лекции совпадений нет — найдено в названии или подписи</>
        )}
      </span>
      <Button size="sm" kind="ghost" icon="up" aria-label="Предыдущее совпадение" disabled={!n} onClick={() => setCur((cur - 1 + n) % n)} />
      <Button size="sm" kind="ghost" icon="down" aria-label="Следующее совпадение" disabled={!n} onClick={() => setCur((cur + 1) % n)} />
      <Button size="sm" kind="ghost" icon="x" aria-label="Убрать подсветку" onClick={onClose} />
    </div>
  );
};

export const LecturePage = () => {
  const { id = '' } = useParams();
  const { client, user } = useApp();
  const lec = useLoad(() => client.call<LectureView>('GET', `/learn/lectures/${id}`), [id]);
  const { busy, run } = useAction();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const body = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<'steps' | 'full'>(() => {
    try {
      return localStorage.getItem('pc.read') === 'full' ? 'full' : 'steps';
    } catch {
      return 'steps';
    }
  });
  /* из поиска лекция открывается целиком — так видны все совпадения (выбор способа чтения не запоминаем) */
  useEffect(() => {
    if (q) setMode('full');
  }, [q, id]);
  /* в фигурных скобках: в новых браузерах scrollTo возвращает Promise, а эффект должен вернуть функцию или ничего */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);
  const pick = (m: 'steps' | 'full') => {
    setMode(m);
    try {
      localStorage.setItem('pc.read', m);
    } catch {
      /* нет доступа к хранилищу */
    }
  };

  return (
    <Async state={lec}>
      {(l) => {
        const heads = l.blocks.flatMap((b, i) => (b.type === 'heading' ? [{ i, text: b.text }] : []));
        const words = l.blocks.reduce((n, b) => n + (b.type === 'text' || b.type === 'note' ? b.text.split(/\s+/).length : b.type === 'list' ? b.items.join(' ').split(/\s+/).length : b.type === 'term' ? b.definition.split(/\s+/).length : 0), 0);
        const minutes = Math.max(1, Math.round(words / 170));
        const figures = l.blocks.filter((b) => b.type === 'image').length;
        const terms = l.blocks.filter((b) => b.type === 'term').length;
        const stepped = heads.length > 1;
        const mark = async () => (await run(() => client.call('POST', `/learn/lectures/${l.id}/view`), 'Отмечено: лекция прочитана')) && lec.reload();
        return (
          <>
            {mode === 'full' && <ReadProgress />}
            <Crumbs course={l.course} module={l.module} />
            <PageHead kicker="Лекция" title={l.title}>
              {stepped && (
                <div className="seg" role="radiogroup" aria-label="Способ чтения">
                  <button type="button" role="radio" aria-checked={mode === 'steps'} className={`seg__btn ${mode === 'steps' ? 'is-on' : ''}`} onClick={() => pick('steps')}>
                    По шагам
                  </button>
                  <button type="button" role="radio" aria-checked={mode === 'full'} className={`seg__btn ${mode === 'full' ? 'is-on' : ''}`} onClick={() => pick('full')}>
                    Весь текст
                  </button>
                </div>
              )}
            </PageHead>
            <p className="read-meta">
              <span>
                <Icon name="clock" size={16} /> около {minutes} мин
              </span>
              {heads.length > 1 && (
                <span>
                  <Icon name="lecture" size={16} /> {heads.length} {plural(heads.length, ['раздел', 'раздела', 'разделов'])}
                </span>
              )}
              {figures > 0 && (
                <span>
                  <Icon name="eye" size={16} /> {figures} {plural(figures, ['рисунок', 'рисунка', 'рисунков'])}
                </span>
              )}
              {terms >= 4 && (
                <span>
                  <Icon name="test" size={16} /> тренажёр терминов
                </span>
              )}
              {l.viewed && <Badge tone="ok">прочитано</Badge>}
            </p>
            {l.module.goal && (
              <div className="note note--info">
                <strong>Цель занятия.</strong> {l.module.goal}
              </div>
            )}
            {stepped && mode === 'steps' ? (
              <Steps key={l.id} lecture={l} onDone={() => void mark()} canMark={user?.role === 'student'} busy={busy} />
            ) : (
              <>
                {q && <FindBar q={q} root={body} dep={l.id} onClose={() => setSp({}, { replace: true })} />}
                <div className={`read ${heads.length > 2 ? 'read--toc' : ''}`}>
                  <article ref={body} className="card lecture">{l.blocks.length ? <Blocks blocks={l.blocks} /> : <Empty title="Лекция пока пустая" />}</article>
                  {heads.length > 2 && <Outline heads={heads} />}
                </div>
                <div className="done-bar">
                  {l.viewed ? (
                    <span className="done-bar__ok">
                      <Icon name="check" /> Лекция прочитана
                    </span>
                  ) : user?.role === 'student' ? (
                    <>
                      <span>Прочитали лекцию до конца?</span>
                      <Button kind="success" icon="check" busy={busy} onClick={() => void mark()}>
                        Отметить как прочитанную
                      </Button>
                    </>
                  ) : (
                    <span className="muted">Учащийся отмечает лекцию прочитанной в конце страницы.</span>
                  )}
                </div>
              </>
            )}
            <Pager courseId={l.course.id} id={l.id} />
          </>
        );
      }}
    </Async>
  );
};

/* ---------- тест ---------- */
interface QView {
  id: string;
  type: QuestionType;
  text: string;
  image?: string;
  points: number;
  options: string[];
  pairs: string[];
}
interface TestView {
  id: string;
  title: string;
  settings: TestSettings;
  questions: QView[];
  module: Ref;
  course: Ref;
  due: string | null;
  attemptNo: number;
  bank: number;
  attempts: { id: string; percent: number; score: number; maxScore: number; createdAt: string }[];
}
interface Result {
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  review: { id: string; correct: boolean; answer: (string | number)[]; explain: string }[];
}

const Q_HINT: Record<QuestionType, string> = {
  single: 'Выберите один ответ',
  multi: 'Выберите все верные ответы',
  match: 'Сопоставьте элементы',
  order: 'Расставьте по порядку стрелками (если порядок верный — ничего не меняйте)',
  short: 'Введите ответ',
  diagram: 'Выберите элемент',
};

const answered = (q: QView, a: unknown) => {
  if (q.type === 'single') return typeof a === 'number';
  if (q.type === 'multi') return Array.isArray(a) && a.length > 0;
  if (q.type === 'match') return Array.isArray(a) && a.length === q.options.length && a.every(Boolean);
  if (q.type === 'order') return Array.isArray(a);
  return typeof a === 'string' && a.trim() !== '';
};

const correctText = (q: QView, answer: (string | number)[]) => {
  if (q.type === 'single' || q.type === 'multi') return answer.map((i) => q.options[Number(i)]).join('; ');
  if (q.type === 'order') return answer.map((x, i) => `${i + 1}) ${x}`).join('; ');
  if (q.type === 'match') return q.options.map((o, i) => `${o} — ${answer[i]}`).join('; ');
  return answer.join(' / ');
};

export const TestPage = () => {
  const { id = '' } = useParams();
  const { client, confirm } = useApp();
  const test = useLoad(() => client.call<TestView>('GET', `/learn/tests/${id}`), [id]);
  const [phase, setPhase] = useState<'intro' | 'run' | 'result'>('intro');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const { busy, run } = useAction();
  const sent = useRef(false);

  useEffect(() => {
    setPhase('intro');
    setResult(null);
  }, [id]);

  const t = test.data;
  const finish = async () => {
    if (!t || sent.current) return;
    sent.current = true;
    /* порядок, который не меняли, отправляется как есть */
    const full: Record<string, unknown> = { ...answers };
    for (const q of t.questions) if (q.type === 'order' && !Array.isArray(full[q.id])) full[q.id] = q.options;
    const r = await run(() => client.call<Result>('POST', `/learn/tests/${t.id}/attempts`, { attemptNo: t.attemptNo, answers: full }));
    sent.current = false;
    if (r) {
      setResult(r);
      setPhase('result');
      void window.scrollTo(0, 0);
      test.reload();
    }
  };

  /* таймер */
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (phase !== 'run' || left === null) return;
    if (left <= 0) {
      void finishRef.current();
      return;
    }
    const timer = setTimeout(() => setLeft((s) => (s === null ? s : s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [phase, left]);

  const start = () => {
    if (!t) return;
    setAnswers({});
    setLeft(t.settings.timeLimitMin > 0 ? t.settings.timeLimitMin * 60 : null);
    setPhase('run');
    window.scrollTo(0, 0);
  };

  const qs = useMemo(() => t?.questions ?? [], [t]);
  const done = qs.filter((q) => answered(q, answers[q.id])).length;
  const missing = qs.filter((q) => q.type !== 'order' && !answered(q, answers[q.id])).length;

  return (
    <Async state={test}>
      {(tv) => {
        const used = tv.attempts.length;
        const limit = tv.settings.attempts;
        const canTry = limit === 0 || used < limit;
        const best = used ? Math.max(...tv.attempts.map((a) => a.percent)) : null;
        return (
          <>
            <Crumbs course={tv.course} module={tv.module} />
            <PageHead kicker="Тест" title={tv.title}>
              {tv.due && <DueBadge due={tv.due} />}
            </PageHead>

            {phase === 'intro' && (
              <section className="card test-intro">
                <ul className="facts">
                  <li>
                    <strong>{tv.questions.length}</strong> {plural(tv.questions.length, ['задание', 'задания', 'заданий'])}
                  </li>
                  <li>
                    проходной результат <strong>{tv.settings.passPercent}%</strong>
                  </li>
                  <li>{tv.settings.timeLimitMin ? <>время <strong>{tv.settings.timeLimitMin} мин</strong></> : 'без ограничения времени'}</li>
                  <li>{limit ? <>попыток <strong>{used} из {limit}</strong></> : 'попыток без ограничений'}</li>
                </ul>
                <p className="muted">{tv.settings.mode === 'self' ? 'После отправки вы увидите разбор: где ошибка и почему.' : 'Контрольный тест: после отправки показывается только итог.'}</p>
                <p className="muted">
                  {tv.bank > tv.questions.length
                    ? `Вариант индивидуальный: вам выдано ${tv.questions.length} ${plural(tv.questions.length, ['задание', 'задания', 'заданий'])} из ${tv.bank}, порядок заданий и ответов у каждого свой.`
                    : tv.settings.shuffle
                      ? 'Порядок заданий и вариантов ответа у каждого учащегося свой.'
                      : ''}
                </p>
                {best !== null && (
                  <p>
                    Лучший результат: <strong>{best}%</strong> {best >= tv.settings.passPercent ? <Badge tone="ok">сдан</Badge> : <Badge tone="warn">пока не сдан</Badge>}
                  </p>
                )}
                {tv.questions.length === 0 ? (
                  <Empty title="В тесте пока нет заданий" />
                ) : canTry ? (
                  <Button kind="primary" className="btn--lg" onClick={start}>
                    {used ? 'Пройти ещё раз' : 'Начать тест'}
                  </Button>
                ) : (
                  <div className="note note--warn">Попытки закончились. Если нужно пересдать, обратитесь к преподавателю.</div>
                )}
                {used > 0 && (
                  <details className="attempts">
                    <summary>Мои попытки ({used})</summary>
                    <ul className="list">
                      {tv.attempts.map((a) => (
                        <li key={a.id} className="list__item list__item--row">
                          <span>{fmtDateTime(a.createdAt)}</span>
                          <Badge tone={a.percent >= tv.settings.passPercent ? 'ok' : 'warn'}>
                            {a.percent}% · {a.score} из {a.maxScore}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}

            {phase === 'run' && (
              <>
                <div className="quiz-bar" role="status">
                  <span>
                    Отвечено <strong>{done}</strong> из {qs.length}
                  </span>
                  <Progress value={qs.length ? (done / qs.length) * 100 : 0} label="Отвечено" />
                  {left !== null && <span className={`quiz-bar__time ${left < 60 ? 'is-low' : ''}`}>{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</span>}
                </div>
                <ol className="quiz">
                  {qs.map((q, i) => (
                    <li key={q.id} className="q card">
                      <p className="q__num">
                        Задание {i + 1} · {Q_HINT[q.type]}
                      </p>
                      <p className="q__text">{q.text}</p>
                      {q.image && <img className="q__img" src={q.image} alt="Рисунок к заданию" />}
                      <QInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                    </li>
                  ))}
                </ol>
                <div className="editor__bar">
                  <Button
                    kind="primary"
                    className="btn--lg"
                    busy={busy}
                    onClick={async () => {
                      if (missing > 0 && !(await confirm({ text: `Без ответа ${missing} ${plural(missing, ['задание', 'задания', 'заданий'])}. Всё равно отправить?`, ok: 'Отправить' }))) return;
                      await finish();
                    }}
                  >
                    Отправить ответы
                  </Button>
                </div>
              </>
            )}

            {phase === 'result' && result && (
              <>
                <section className={`result card ${result.passed ? 'result--ok' : 'result--bad'}`}>
                  <span className="result__percent">{result.percent}%</span>
                  <div>
                    <p className="result__title">{result.passed ? 'Тест сдан' : 'Пока не сдан'}</p>
                    <p className="muted">
                      Набрано {result.score} из {result.maxScore} {plural(result.maxScore, ['балла', 'баллов', 'баллов'])}. Проходной результат — {tv.settings.passPercent}%.
                    </p>
                    {!result.passed && (tv.settings.gate ?? tv.settings.mode !== 'control') && (tv.settings.attempts === 0 || tv.attempts.length < tv.settings.attempts) && (
                      <p className="result__gate">
                        <Icon name="lock" size={16} /> Следующие модули откроются, когда тест будет сдан не ниже чем на {tv.settings.passPercent} %. Повторите лекцию и пройдите тест ещё раз.
                      </p>
                    )}
                  </div>
                  <div className="result__actions">
                    {(tv.settings.attempts === 0 || tv.attempts.length < tv.settings.attempts) && <Button onClick={start}>Пройти ещё раз</Button>}
                    <Link to={`/learn/${tv.course.id}`} className="btn">
                      К курсу
                    </Link>
                  </div>
                </section>
                {result.review.length > 0 && (
                  <ol className="quiz">
                    {qs.map((q, i) => {
                      const r = result.review.find((x) => x.id === q.id);
                      if (!r) return null;
                      return (
                        <li key={q.id} className={`q card ${r.correct ? 'q--ok' : 'q--bad'}`}>
                          <p className="q__num">
                            Задание {i + 1} · {r.correct ? 'верно' : 'ошибка'}
                          </p>
                          <p className="q__text">{q.text}</p>
                          {!r.correct && (
                            <p>
                              Правильный ответ: <strong>{correctText(q, r.answer)}</strong>
                            </p>
                          )}
                          {r.explain && <p className="muted">{r.explain}</p>}
                        </li>
                      );
                    })}
                  </ol>
                )}
                <Pager courseId={tv.course.id} id={tv.id} />
              </>
            )}
            {phase === 'intro' && <Pager courseId={tv.course.id} id={tv.id} />}
          </>
        );
      }}
    </Async>
  );
};

const QInput = ({ q, value, onChange }: { q: QView; value: unknown; onChange: (v: unknown) => void }) => {
  if (q.type === 'single' || q.type === 'multi') {
    const multi = q.type === 'multi';
    const sel = multi ? ((value as number[] | undefined) ?? []) : value;
    return (
      <div className="opts" role={multi ? 'group' : 'radiogroup'}>
        {q.options.map((o, k) => {
          const on = multi ? (sel as number[]).includes(k) : sel === k;
          return (
            <label key={k} className={`opt ${on ? 'is-on' : ''}`}>
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={`q-${q.id}`}
                checked={on}
                onChange={(e) => onChange(multi ? (e.target.checked ? [...(sel as number[]), k] : (sel as number[]).filter((x) => x !== k)) : k)}
              />
              <span className="opt__l" aria-hidden="true">
                {'abcdefghij'[k]})
              </span>
              <span>{o}</span>
            </label>
          );
        })}
      </div>
    );
  }
  if (q.type === 'match') {
    const cur = (value as string[] | undefined) ?? q.options.map(() => '');
    return (
      <div className="match">
        {q.options.map((o, k) => (
          <label key={k} className="match__row">
            <span className="match__left">{o}</span>
            <select className="input" value={cur[k] ?? ''} onChange={(e) => onChange(cur.map((x, j) => (j === k ? e.target.value : (x ?? ''))))}>
              <option value="">— выберите —</option>
              {q.pairs.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'order') {
    const cur = (value as string[] | undefined) ?? q.options;
    const move = (k: number, d: number) => {
      const j = k + d;
      if (j < 0 || j >= cur.length) return;
      const next = cur.slice();
      [next[k], next[j]] = [next[j]!, next[k]!];
      onChange(next);
    };
    return (
      <ol className="order">
        {cur.map((o, k) => (
          <li key={o} className="order__item">
            <span className="order__n">{k + 1}</span>
            <span className="order__text">{o}</span>
            <Button size="sm" kind="ghost" icon="up" aria-label="Выше" disabled={k === 0} onClick={() => move(k, -1)} />
            <Button size="sm" kind="ghost" icon="down" aria-label="Ниже" disabled={k === cur.length - 1} onClick={() => move(k, 1)} />
          </li>
        ))}
      </ol>
    );
  }
  return <input className="input" aria-label="Ответ" placeholder="Ваш ответ" value={(value as string | undefined) ?? ''} onChange={(e) => onChange(e.target.value)} />;
};

/* ---------- лабораторная ---------- */
interface FileInfo {
  id: string;
  name: string;
  size: number;
}
interface LabView {
  id: string;
  title: string;
  goal: string;
  description: string;
  variants: string[];
  criteria: string[];
  maxScore: number;
  allowFiles: boolean;
  templates: FileInfo[];
  module: Ref;
  course: Ref;
  due: string | null;
  preview: boolean;
  blocks?: Block[];
  controlQuestions?: string[];
  myVariant: number | null;
  diagramKind: string | null;
  hasReference: boolean;
  submissions: { id: string; version: number; diagram: Diagram | null; autoScore: number | null; status: SubmissionStatus; grade: number | null; comment: string; teacherComment: string; createdAt: string; gradedAt: string | null; late: boolean; files: FileInfo[] }[];
}

export const LabPage = () => {
  const { id = '' } = useParams();
  const { client } = useApp();
  const lab = useLoad(() => client.call<LabView>('GET', `/learn/labs/${id}`), [id]);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [comment, setComment] = useState('');
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [check, setCheck] = useState<DiagramCheck | null>(null);
  const { busy, run } = useAction();
  const up = useAction();
  const draftKey = `pc.diagram.${id}`;

  /* черновик диаграммы хранится в браузере, пока работа не сдана */
  useEffect(() => {
    const l = lab.data;
    if (!l?.diagramKind) return;
    let draft: Diagram | null = null;
    try {
      draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Diagram | null;
    } catch {
      /* нет доступа к хранилищу */
    }
    setDiagram(draft && draft.kind === l.diagramKind ? draft : (l.submissions[0]?.diagram ?? emptyDiagram(l.diagramKind)));
    setCheck(null);
  }, [lab.data, draftKey]);
  const changeDiagram = (d: Diagram) => {
    setDiagram(d);
    setCheck(null);
    try {
      localStorage.setItem(draftKey, JSON.stringify(d));
    } catch {
      /* нет доступа к хранилищу */
    }
  };

  return (
    <Async state={lab}>
      {(l) => {
        const last = l.submissions[0];
        const locked = last?.status === 'graded' || last?.status === 'submitted';
        return (
          <>
            <Crumbs course={l.course} module={l.module} />
            <PageHead kicker="Лабораторная работа" title={l.title}>
              {l.due && <DueBadge due={l.due} />}
            </PageHead>
            {l.preview && <PreviewNote />}
            <div className="grid grid--side">
              {/* задание */}
              <article className="card lab">
                {l.goal && (
                  <>
                    <h2 className="card__subtitle">Цель работы</h2>
                    <p>{l.goal}</p>
                  </>
                )}
                {(l.description || !l.blocks?.length) && (
                  <>
                    <h2 className="card__subtitle">Задание</h2>
                    <div className="lab__text">{l.description || 'Описание задания появится позже.'}</div>
                  </>
                )}
                {l.variants.length > 0 && (
                  <>
                    <h2 className="card__subtitle">Варианты</h2>
                    {l.myVariant !== null && (
                      <div className="my-variant">
                        <span className="my-variant__n">{l.myVariant + 1}</span>
                        <span>
                          <strong>Ваш вариант: {l.variants[l.myVariant]}</strong>
                          <small>Выдан автоматически по номеру в списке группы</small>
                        </span>
                      </div>
                    )}
                    <ol className="variants">
                      {l.variants.map((v, i) => (
                        <li key={i} className={i === l.myVariant ? 'is-mine' : ''}>
                          {v}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                {l.criteria.length > 0 && (
                  <>
                    <h2 className="card__subtitle">Как оценивается (из {l.maxScore} баллов)</h2>
                    <ul className="outcomes">
                      {l.criteria.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
                {l.templates.length > 0 && (
                  <>
                    <h2 className="card__subtitle">Материалы к работе</h2>
                    <div className="files">
                      {l.templates.map((f) => (
                        <FileLink key={f.id} id={f.id} name={f.name} />
                      ))}
                    </div>
                  </>
                )}
              </article>

              {/* сдача */}
              <aside className="card submit">
                <h2 className="card__title">Сдача работы</h2>
                <SubmitStatus last={last} />
                {!locked && !l.preview && (
                  <div className="form">
                    {l.allowFiles && (
                      <div className="field">
                        <span className="field__label">Файлы отчёта</span>
                        <div className="files files--col">
                          {files.map((f) => (
                            <span key={f.id} className="files__item">
                              <Icon name="file" size={18} />
                              <span className="files__name">{f.name}</span>
                              <span className="muted">{fileSize(f.size)}</span>
                              <Button size="sm" kind="ghost" icon="x" aria-label={`Убрать ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))} />
                            </span>
                          ))}
                        </div>
                        <label className={`dropzone ${up.busy ? 'is-busy' : ''}`}>
                          <input
                            type="file"
                            multiple
                            className="visually-hidden"
                            onChange={async (e) => {
                              const list = Array.from(e.target.files ?? []);
                              e.target.value = '';
                              for (const f of list.slice(0, 10 - files.length)) {
                                const row = await up.run(() => client.upload(f, 'submission'));
                                if (row) setFiles((x) => [...x, { id: row.id, name: row.name, size: row.size }]);
                              }
                            }}
                          />
                          <Icon name="upload" />
                          <span>{up.busy ? 'Загрузка…' : 'Выбрать файлы'}</span>
                          <small>до 20 МБ каждый: docx, pdf, png, jpg, zip и др.</small>
                        </label>
                      </div>
                    )}
                    <Field label="Комментарий преподавателю" hint="Необязательно: вариант, что не получилось, ссылка на репозиторий">
                      {(fid) => <textarea id={fid} className="input textarea" value={comment} onChange={(e) => setComment(e.target.value)} />}
                    </Field>
                    <Button
                      kind="primary"
                      className="btn--lg btn--block"
                      icon="send"
                      busy={busy}
                      disabled={!files.length && !comment.trim() && !diagram?.nodes.length}
                      onClick={async () => {
                        const ok = await run(() => client.call('POST', `/learn/labs/${l.id}/submissions`, { fileIds: files.map((f) => f.id), comment, diagram: diagram?.nodes.length ? diagram : null }), 'Работа отправлена на проверку');
                        if (ok) {
                          setFiles([]);
                          setComment('');
                          try {
                            localStorage.removeItem(draftKey);
                          } catch {
                            /* нет доступа */
                          }
                          lab.reload();
                        }
                      }}
                    >
                      {last?.status === 'returned' ? 'Отправить исправленную работу' : 'Отправить на проверку'}
                    </Button>
                  </div>
                )}
                {l.preview && <p className="muted">Сдают работу учащиеся. Сотрудник видит задание так же, как учащийся.</p>}
                {l.submissions.length > 0 && (
                  <details className="versions" open={l.submissions.length < 3}>
                    <summary>История сдачи ({l.submissions.length})</summary>
                    <ol className="versions__list">
                      {l.submissions.map((s) => (
                        <li key={s.id} className="versions__item">
                          <div className="versions__head">
                            <strong>Версия {s.version}</strong>
                            <Badge tone={SUB_STATUS[s.status].tone}>{SUB_STATUS[s.status].label}</Badge>
                            {s.late && <Badge tone="err">после срока</Badge>}
                          </div>
                          <span className="muted">{fmtDateTime(s.createdAt)}</span>
                          {s.files.length > 0 && (
                            <div className="files">
                              {s.files.map((f) => (
                                <FileLink key={f.id} id={f.id} name={f.name} />
                              ))}
                            </div>
                          )}
                          {s.comment && <p className="versions__text">{s.comment}</p>}
                          {s.teacherComment && (
                            <p className="versions__teacher">
                              <strong>Преподаватель:</strong> {s.teacherComment}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </aside>
            </div>
            {/* методические указания */}
            {(l.blocks?.length ?? 0) > 0 && <Guide blocks={l.blocks!} questions={l.controlQuestions ?? []} />}
            {l.diagramKind && diagram && (!locked || diagram.nodes.length > 0) && (
              <section className="card diagram-card">
                <div className="card__head">
                  <h2 className="card__title">{DIAGRAM_SPEC[l.diagramKind as DiagramKind]?.title ?? 'Диаграмма'}</h2>
                  {l.hasReference && <Badge tone="info">есть эталон для автопроверки</Badge>}
                </div>
                <p className="muted">
                  {locked ? 'Диаграмма из последней сданной версии.' : 'Постройте диаграмму здесь: перетаскивайте элементы, соединяйте их связями. Кнопка «Проверить» покажет ошибки нотации и насколько диаграмма совпадает с эталоном, не раскрывая ответ. Черновик сохраняется автоматически.'}
                </p>
                <DiagramEditor
                  value={diagram}
                  onChange={changeDiagram}
                  readOnly={locked}
                  onCheck={
                    locked
                      ? undefined
                      : async () => {
                          const r = await run(() => client.call<DiagramCheck>('POST', `/learn/labs/${l.id}/check`, { diagram }));
                          if (r) setCheck(r);
                        }
                  }
                />
                {check && <CheckResult r={check} />}
              </section>
            )}
            <Pager courseId={l.course.id} id={l.id} />
          </>
        );
      }}
    </Async>
  );
};

/* методические указания: разделы раскрываются по нажатию, задание и порядок открыты сразу */
const Guide = ({ blocks, questions }: { blocks: Block[]; questions: string[] }) => {
  const parts: { title: string; blocks: Block[] }[] = [];
  for (const b of blocks) {
    if (b.type === 'heading') parts.push({ title: b.text, blocks: [] });
    else if (parts.length) parts[parts.length - 1]!.blocks.push(b);
    else parts.push({ title: 'Задание', blocks: [b] });
  }
  return (
    <section className="card guide" aria-labelledby="guide-title">
      <h2 id="guide-title" className="card__title">
        Методические указания
      </h2>
      {parts.map((p, i) => (
        <details key={i} className="guide__part" open={/^(Задание|Порядок)/.test(p.title)}>
          <summary className="guide__head">{p.title}</summary>
          <div className="guide__body">
            <Blocks blocks={p.blocks} />
          </div>
        </details>
      ))}
      {questions.length > 0 && (
        <details className="guide__part">
          <summary className="guide__head">Контрольные вопросы — для защиты работы</summary>
          <ol className="lb-list guide__body">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
};

const SubmitStatus = ({ last }: { last: LabView['submissions'][0] | undefined }) => {
  if (!last) return <p className="submit__state">Работа ещё не сдана. Прикрепите файлы отчёта и отправьте на проверку.</p>;
  if (last.status === 'graded') {
    return (
      <div className="submit__grade">
        <span className={`grade grade--xl ${last.grade !== null && last.grade < 4 ? 'grade--low' : ''}`}>{last.grade}</span>
        <div>
          <strong>Работа оценена</strong>
          <p className="muted">{fmtDate(last.gradedAt)}</p>
          {last.teacherComment && <p>{last.teacherComment}</p>}
        </div>
      </div>
    );
  }
  if (last.status === 'submitted') {
    return (
      <div className="note note--info">
        Версия {last.version} отправлена {fmtDateTime(last.createdAt)} и ждёт проверки. Когда преподаватель проверит, придёт уведомление.
      </div>
    );
  }
  return (
    <div className="note note--warn">
      <strong>Работу вернули на доработку.</strong>
      {last.teacherComment ? `\nЧто исправить: ${last.teacherComment}` : ''}
    </div>
  );
};
