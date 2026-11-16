/* анализ заданий теста: что усвоено, а что нет, какие задания стоит переписать.
   Показатели — доля верных ответов, различающая способность, частые неверные ответы, надёжность теста */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { QuestionType } from '@pc/core';
import { useApp } from '../lib/app.tsx';
import { plural } from '../lib/format.ts';
import { useLoad } from '../lib/hooks.ts';
import { Async, Badge, Empty, Icon, PageHead } from '../ui/ui.tsx';

interface QStat {
  id: string;
  n: number;
  type: QuestionType;
  text: string;
  options: string[];
  pairs: string[];
  answer: (string | number)[];
  shown: number;
  correct: number;
  p: number | null;
  d: number | null;
  level: string | null;
  discr: string | null;
  opts: number[];
  mapped: number;
  blank: number;
  wrong: { text: string; count: number }[];
  advice: string[];
}
interface Stats {
  test: { id: string; title: string; pass: number; mode: string; bank: number; pick: number };
  module: { id: string; title: string };
  course: { id: string; title: string };
  groups: { id: string; name: string }[];
  groupId: string | null;
  summary: {
    members: number;
    students: number;
    attempts: number;
    analyzed: number;
    avgFirst: number | null;
    avgBest: number | null;
    gain: number | null;
    passed: number;
    passRate: number | null;
    dist: number[];
    reliability: number | null;
    reliabilityText: string | null;
  };
  questions: QStat[];
}

const TYPE: Record<QuestionType, string> = {
  single: 'один ответ',
  multi: 'несколько ответов',
  match: 'соответствие',
  order: 'последовательность',
  short: 'краткий ответ',
  diagram: 'по диаграмме',
};

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const dec = (x: number | null) => (x === null ? '—' : x.toFixed(2).replace('.', ','));
const tone = (p: number | null) => (p === null ? 'muted' : p >= 0.85 ? 'info' : p >= 0.5 ? 'ok' : p >= 0.25 ? 'warn' : 'err');

/* распределение лучших результатов учащихся по десяткам процентов; черта — проходной процент */
const DistChart = ({ dist, pass }: { dist: number[]; pass: number }) => {
  const max = Math.max(1, ...dist);
  return (
    <figure className="hist" aria-label="Распределение лучших результатов">
      <div className="hist__bars">
        {dist.map((v, i) => (
          <div key={i} className={`hist__col ${i * 10 >= pass ? 'is-pass' : ''}`} title={`${i * 10}–${i === 9 ? 100 : i * 10 + 9} %: ${v}`}>
            <span className="hist__v">{v || ''}</span>
            <span className="hist__bar" style={{ height: `${(v / max) * 100}%` }} />
            <span className="hist__x">{i * 10}</span>
          </div>
        ))}
        <span className="hist__pass" style={{ left: `${pass}%` }} aria-hidden="true">
          <span>проходной {pass} %</span>
        </span>
      </div>
      <figcaption className="muted small">Лучший результат каждого учащегося, %</figcaption>
    </figure>
  );
};

const QuestionCard = ({ q }: { q: QStat }) => {
  const key = new Set(q.type === 'single' || q.type === 'multi' ? q.answer.map(Number) : []);
  const most = Math.max(1, ...q.opts);
  return (
    <article className={`qstat card ${q.advice.length ? 'qstat--warn' : ''}`} id={`q-${q.id}`}>
      <header className="qstat__head">
        <span className="qstat__n">{q.n}</span>
        <div className="qstat__titles">
          <p className="qstat__text">{q.text}</p>
          <p className="qstat__meta">
            {TYPE[q.type]} · ответили {q.shown}
            {q.blank > 0 && ` · без ответа ${q.blank}`}
          </p>
        </div>
        <div className="qstat__badges">
          {q.level && <Badge tone={tone(q.p)}>{q.level}</Badge>}
          {q.discr && <Badge tone={q.d !== null && q.d < 0 ? 'err' : q.d !== null && q.d >= 0.3 ? 'ok' : 'muted'}>{q.discr}</Badge>}
        </div>
      </header>
      {q.shown === 0 ? (
        <p className="muted">Это задание ещё никому не попадалось.</p>
      ) : (
        <>
          <div className="qstat__nums">
            <div>
              <span className="qstat__big">{pct(q.p)}</span>
              <span className="muted small">
                верно ({q.correct} из {q.shown})
              </span>
            </div>
            <div className="qstat__meter" aria-hidden="true">
              <span style={{ width: `${(q.p ?? 0) * 100}%` }} />
            </div>
            <div>
              <span className="qstat__big">{dec(q.d)}</span>
              <span className="muted small">{q.d === null ? "различающая способность: нужно 8+ ответов" : "различающая способность"}</span>
            </div>
          </div>
          {q.opts.length > 0 && q.mapped > 0 && (
            <ul className="qstat__opts">
              {q.options.map((o, i) => (
                <li key={i} className={key.has(i) ? 'is-key' : ''}>
                  <span className="qstat__opt">
                    {key.has(i) && <Icon name="check" size={14} />} {o}
                  </span>
                  <span className="qstat__obar">
                    <span style={{ width: `${((q.opts[i] ?? 0) / most) * 100}%` }} />
                  </span>
                  <span className="qstat__oc">
                    {q.opts[i]} · {Math.round(((q.opts[i] ?? 0) / q.mapped) * 100)} %
                  </span>
                </li>
              ))}
            </ul>
          )}
          {q.type === 'short' && (
            <p className="small">
              Принимаемые ответы: <strong>{q.answer.join('; ')}</strong>
              {q.wrong.length > 0 && <> · частые неверные: {q.wrong.map((w) => `«${w.text}» (${w.count})`).join(', ')}</>}
            </p>
          )}
          {(q.type === 'order' || q.type === 'match') && (
            <p className="small muted">
              {q.type === 'order' ? 'Правильный порядок: ' : 'Пары: '}
              {q.type === 'order' ? q.options.join(' → ') : q.options.map((o, i) => `${o} — ${q.pairs[i]}`).join('; ')}
            </p>
          )}
          {q.advice.map((a, i) => (
            <p key={i} className="qstat__advice">
              <Icon name="flag" size={16} /> {a}
            </p>
          ))}
        </>
      )}
    </article>
  );
};

export const TestStatsPage = () => {
  const { id = '' } = useParams();
  const { client } = useApp();
  const [groupId, setGroupId] = useState('');
  const [only, setOnly] = useState(false);
  const [sort, setSort] = useState<'n' | 'hard'>('n');
  const st = useLoad(() => client.call<Stats>('GET', `/tests/${id}/stats`, undefined, { groupId }), [id, groupId]);

  return (
    <Async state={st}>
      {(s) => {
        const attention = s.questions.filter((q) => q.advice.length);
        let list = only ? attention : s.questions;
        if (sort === 'hard') list = [...list].sort((a, b) => (a.p ?? 2) - (b.p ?? 2));
        return (
          <>
            <PageHead
              kicker={`Анализ заданий · ${s.module.title}`}
              title={s.test.title}
              back={
                <Link to={`/edit/tests/${s.test.id}`} className="back">
                  <Icon name="arrow-left" size={16} /> Тест
                </Link>
              }
            >
              {s.groups.length > 1 && (
                <select className="input input--inline" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Группа">
                  <option value="">Все группы</option>
                  {s.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </PageHead>

            {s.summary.attempts === 0 ? (
              <section className="card">
                <Empty title="Тест ещё никто не проходил" text={s.groups.length ? 'Анализ появится после первых попыток учащихся.' : 'Курс пока не назначен группам, которые вы ведёте.'} />
              </section>
            ) : (
              <>
                <section className="kpis stats-kpis">
                  <div className="kpi">
                    <span className="kpi__value">
                      {s.summary.students}
                      <small> из {s.summary.members}</small>
                    </span>
                    <span className="kpi__label">учащихся прошли тест</span>
                  </div>
                  <div className="kpi">
                    <span className="kpi__value">{s.summary.attempts}</span>
                    <span className="kpi__label">{plural(s.summary.attempts, ['попытка', 'попытки', 'попыток'])}</span>
                  </div>
                  <div className="kpi">
                    <span className="kpi__value">
                      {s.summary.avgFirst ?? '—'} → {s.summary.avgBest ?? '—'} %
                    </span>
                    <span className="kpi__label">средний результат: первая → лучшая попытка{s.summary.gain ? ` (+${s.summary.gain})` : ''}</span>
                  </div>
                  <div className="kpi">
                    <span className="kpi__value">{pct(s.summary.passRate)}</span>
                    <span className="kpi__label">
                      сдали ({s.summary.passed}) · проходной {s.test.pass} %
                    </span>
                  </div>
                  <button type="button" className={`kpi kpi--btn ${attention.length ? 'kpi--warn' : ''}`} onClick={() => (setOnly(true), document.querySelector('.qstats, .toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))}>
                    <span className="kpi__value">
                      {attention.length}
                      <small> из {s.questions.length}</small>
                    </span>
                    <span className="kpi__label">{attention.length ? 'заданий требуют внимания — показать' : 'замечаний к заданиям нет'}</span>
                  </button>
                </section>

                <section className="card stats-top">
                  <DistChart dist={s.summary.dist} pass={s.test.pass} />
                  <div className="stats-help">
                    <h2 className="card__subtitle">Как читать показатели</h2>
                    <ul className="lb-list">
                      <li>
                        <strong>Верно, %</strong> — доля ответивших правильно. Больше 85 % — задание лёгкое, меньше 25 % — очень трудное.
                      </li>
                      <li>
                        <strong>Различающая способность</strong> — насколько чаще задание решают сильные учащиеся (лучшие 27 % попыток), чем слабые (худшие 27 %). От 0,3 — хорошо; меньше 0 — повод проверить ключ.
                      </li>
                      <li>
                        <strong>Надёжность</strong> (KR-20) — согласованность теста в целом, от 0,7 — хорошая. Считается для теста от 10 заданий и 20 попыток с одним набором заданий.
                      </li>
                      <li>Рост от первой попытки к лучшей показывает, помогает ли разбор ошибок.</li>
                    </ul>
                    <p className="stats-help__rel">
                      Надёжность этого теста:{' '}
                      {s.summary.reliability === null ? (
                        <span className="muted">недостаточно данных</span>
                      ) : (
                        <strong>
                          {dec(s.summary.reliability)} — {s.summary.reliabilityText}
                        </strong>
                      )}
                    </p>
                  </div>
                </section>

                <div className="toolbar">
                  <div className="seg" role="radiogroup" aria-label="Какие задания показать">
                    <button type="button" role="radio" aria-checked={!only} className={`seg__btn ${!only ? 'is-on' : ''}`} onClick={() => setOnly(false)}>
                      Все задания ({s.questions.length})
                    </button>
                    <button type="button" role="radio" aria-checked={only} className={`seg__btn ${only ? 'is-on' : ''}`} onClick={() => setOnly(true)}>
                      Требуют внимания ({attention.length})
                    </button>
                  </div>
                  <select className="input input--inline" value={sort} onChange={(e) => setSort(e.target.value as 'n')} aria-label="Порядок">
                    <option value="n">По номеру</option>
                    <option value="hard">Сначала трудные</option>
                  </select>
                  <span className="muted small">
                    Ответы по заданиям есть у {s.summary.analyzed} из {s.summary.attempts} попыток
                  </span>
                </div>
                {list.length === 0 ? (
                  <section className="card">
                    <Empty title="Замечаний нет" text="Все задания работают как задумано." />
                  </section>
                ) : (
                  <div className="qstats">
                    {list.map((q) => (
                      <QuestionCard key={q.id} q={q} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        );
      }}
    </Async>
  );
};
