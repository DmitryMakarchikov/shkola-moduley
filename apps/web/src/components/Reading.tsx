/* вопросы по ходу чтения: задания из теста для самопроверки модуля встают сразу после раздела лекции,
   к которому относятся; остальные — блоком «Проверьте себя» в конце. Без отметки и без попытки */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { LecturePart } from '@pc/core';
import { useApp } from '../lib/app.tsx';
import { plural } from '../lib/format.ts';
import { Button, ErrorBox, Icon } from '../ui/ui.tsx';

export interface ReadQ {
  id: string;
  type: 'single' | 'multi';
  text: string;
  options: string[];
  image?: string;
  after: number | null;
}
export interface ReadQs {
  testId: string | null;
  testTitle: string;
  questions: ReadQ[];
}
interface Res {
  correct: boolean;
  answer: number[];
  explain: string;
}
interface Ans {
  pick: number[];
  res: Res | null;
}

/* где показать задания: after — номер последнего блока раздела (его выбирает сервер), иначе — в конце */
export const placeByAfter = (parts: LecturePart[], questions: ReadQ[]) => {
  const byPart = new Map<number, ReadQ>();
  const byBlock = new Map<number, ReadQ>();
  const rest: ReadQ[] = [];
  for (const q of questions) {
    const pi = q.after === null ? -1 : parts.findIndex((p) => p.last === q.after);
    if (pi < 0 || byPart.has(pi)) rest.push(q);
    else {
      byPart.set(pi, q);
      byBlock.set(q.after!, q);
    }
  }
  return { byPart, byBlock, rest };
};

/* ответы хранятся на странице лекции: при переходе между шагами и способами чтения не сбрасываются */
const ReadCtx = createContext<{ testId: string; ans: Record<string, Ans>; set: (id: string, a: Ans) => void } | null>(null);
export const ReadingProvider = ({ testId, children }: { testId: string | null | undefined; children: ReactNode }) => {
  const [ans, setAns] = useState<Record<string, Ans>>({});
  const value = useMemo(() => (testId ? { testId, ans, set: (id: string, a: Ans) => setAns((m) => ({ ...m, [id]: a })) } : null), [testId, ans]);
  return <ReadCtx.Provider value={value}>{children}</ReadCtx.Provider>;
};

const LETTERS = 'АБВГДЕЖЗИК';

export const InlineQuestion = ({ q, label = 'Вопрос по прочитанному' }: { q: ReadQ; label?: string }) => {
  const { client } = useApp();
  const ctx = useContext(ReadCtx);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!ctx) return null;
  const a = ctx.ans[q.id] ?? { pick: [], res: null };
  const res = a.res;
  const check = async (pick: number[]) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await client.call<Res>('POST', `/learn/tests/${ctx.testId}/check`, { questionId: q.id, answer: q.type === 'single' ? pick[0] : pick });
      ctx.set(q.id, { pick, res: r });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`inq ${res ? (res.correct ? 'is-ok' : 'is-bad') : ''}`} aria-label={label}>
      <p className="inq__kicker">
        <Icon name="question" size={16} /> {label}
      </p>
      <p className="inq__text">{q.text}</p>
      {q.image && <img className="inq__img" src={q.image} alt="Рисунок к заданию" loading="lazy" />}
      {!res && <p className="inq__how">{q.type === 'single' ? 'Нажмите на ответ — проверка сразу' : 'Отметьте все верные ответы и нажмите «Проверить»'}</p>}
      <div className="inq__opts">
        {q.options.map((o, i) => {
          const on = a.pick.includes(i);
          const right = !!res && res.answer.includes(i);
          const state = !res ? (on ? 'is-on' : '') : right ? 'is-right' : on ? 'is-wrong' : 'is-dim';
          return (
            <button
              key={i}
              type="button"
              className={`inq__opt ${state}`}
              disabled={!!res || busy}
              aria-pressed={on}
              onClick={() => {
                if (q.type === 'single') {
                  ctx.set(q.id, { pick: [i], res: null });
                  void check([i]);
                } else ctx.set(q.id, { pick: on ? a.pick.filter((x) => x !== i) : [...a.pick, i], res: null });
              }}
            >
              <span className={`inq__mark ${q.type === 'multi' ? 'inq__mark--box' : ''}`} aria-hidden="true">
                {res ? (right ? '✓' : on ? '✕' : LETTERS[i]) : q.type === 'single' ? LETTERS[i] : on ? '✓' : ''}
              </span>
              <span className="inq__label">{o}</span>
            </button>
          );
        })}
      </div>
      {res ? (
        <div className="inq__res" role="status">
          <p className="inq__verdict">
            <Icon name={res.correct ? 'check' : 'info'} size={18} /> {res.correct ? 'Верно' : 'Не совсем: верный ответ отмечен зелёным'}
          </p>
          {res.explain && <p className="inq__explain">{res.explain}</p>}
        </div>
      ) : (
        q.type === 'multi' && (
          <Button kind="primary" disabled={!a.pick.length} busy={busy} onClick={() => void check(a.pick)}>
            Проверить
          </Button>
        )
      )}
      {err && <ErrorBox text={err} />}
    </section>
  );
};

/* «Проверьте себя»: задания, которые не встали после разделов, — по одному, с итогом */
export const QuestionDeck = ({ questions, title }: { questions: ReadQ[]; title: string }) => {
  const ctx = useContext(ReadCtx);
  const [i, setI] = useState(0);
  if (!ctx || !questions.length) return null;
  const done = questions.filter((q) => ctx.ans[q.id]?.res);
  const right = done.filter((q) => ctx.ans[q.id]?.res?.correct).length;
  const cur = Math.min(i, questions.length - 1);
  const q = questions[cur]!;
  const answered = !!ctx.ans[q.id]?.res;
  const all = done.length === questions.length;
  return (
    <section className="deck" aria-label="Проверьте себя">
      <div className="deck__head">
        <h3 className="deck__title">Проверьте себя</h3>
        <span className={`deck__score ${all ? 'is-final' : ''}`}>
          {done.length ? `верно ${right} из ${done.length}` : `${questions.length} ${plural(questions.length, ['вопрос', 'вопроса', 'вопросов'])}`}
        </span>
      </div>
      <p className="deck__sub">Задания из теста «{title}». Без отметки: ответы не сохраняются и на оценку не влияют.</p>
      {questions.length > 1 && (
        <ol className="deck__dots" aria-label="Вопросы">
          {questions.map((x, j) => {
            const r = ctx.ans[x.id]?.res;
            return (
              <li key={x.id}>
                <button type="button" className={`deck__dot ${j === cur ? 'is-current' : ''} ${r ? (r.correct ? 'is-ok' : 'is-bad') : ''}`} aria-label={`Вопрос ${j + 1}`} aria-current={j === cur ? 'step' : undefined} onClick={() => setI(j)} />
              </li>
            );
          })}
        </ol>
      )}
      <InlineQuestion key={q.id} q={q} label={`Вопрос ${cur + 1} из ${questions.length}`} />
      {answered && cur + 1 < questions.length && (
        <div className="deck__next">
          <Button kind="primary" onClick={() => setI(cur + 1)}>
            <span>Следующий вопрос</span>
            <Icon name="arrow-right" size={18} />
          </Button>
        </div>
      )}
      {all && questions.length > 1 && (
        <p className="deck__total">
          {right === questions.length ? 'Все ответы верные — материал усвоен.' : right >= questions.length / 2 ? 'Хороший результат. Вернитесь к разделам, где были ошибки.' : 'Стоит перечитать лекцию и пройти тест для самопроверки.'}
        </p>
      )}
    </section>
  );
};
