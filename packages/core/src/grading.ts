/* проверка тестов: шесть типов заданий и индивидуальный вариант для каждой попытки */
import type { Question, Test } from './model.ts';
import { norm } from './validate.ts';

const sameSet = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x) => b.includes(x));

export const checkQuestion = (q: Question, answer: unknown): boolean => {
  switch (q.type) {
    case 'single':
      return typeof answer === 'number' && answer === q.answer[0];
    case 'multi':
      return Array.isArray(answer) && sameSet(answer, q.answer);
    case 'order':
      /* options хранятся в правильном порядке, учащийся присылает тексты в своём порядке */
      return Array.isArray(answer) && answer.length === q.options.length && answer.every((x, i) => x === q.options[i]);
    case 'match':
      /* pairs[i] — правильная пара для options[i] */
      return Array.isArray(answer) && answer.length === q.pairs.length && answer.every((x, i) => x === q.pairs[i]);
    case 'short':
      return typeof answer === 'string' && q.answer.some((a) => norm(a) === norm(answer));
    case 'diagram':
      return typeof answer === 'string' && answer === q.answer[0];
    default:
      return false;
  }
};

/* перемешивание без мутации исходного массива; rnd — источник случайности */
export const shuffled = <T>(arr: T[], rnd: () => number = Math.random): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
};

/* повторяемая случайность: одна и та же строка-зерно даёт одну и ту же последовательность */
export const seeded = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface TestVariant {
  /* задания попытки в порядке показа */
  questions: Question[];
  /* для заданий с выбором: порядок показа вариантов (позиция → исходный индекс) */
  optionOrder: Record<string, number[]>;
  /* перемешанные тексты для «порядка» и «соответствия» */
  display: Record<string, string[]>;
}

/* вариант теста для попытки: набор из банка, порядок заданий и вариантов.
   Зерно — учащийся, тест и номер попытки, поэтому сервер восстанавливает вариант при проверке */
export const variantOf = (test: Test, seed: string): TestVariant => {
  const rnd = seeded(seed);
  const pick = test.settings.pick ?? 0;
  const mix = test.settings.shuffle;
  let questions = test.questions;
  if (pick > 0 && pick < questions.length) {
    const chosen = new Set(shuffled(questions, rnd).slice(0, pick).map((q) => q.id));
    questions = questions.filter((q) => chosen.has(q.id));
  }
  if (mix) questions = shuffled(questions, rnd);
  const optionOrder: Record<string, number[]> = {};
  const display: Record<string, string[]> = {};
  for (const q of questions) {
    if (q.type === 'single' || q.type === 'multi') {
      const idx = q.options.map((_, i) => i);
      optionOrder[q.id] = mix && !q.fixed ? shuffled(idx, rnd) : idx;
    }
    if (q.type === 'order') display[q.id] = shuffled(q.options, rnd);
    if (q.type === 'match') display[q.id] = shuffled(q.pairs, rnd);
  }
  return { questions, optionOrder, display };
};

/* ответ учащегося (в его порядке вариантов) → исходные индексы */
const toOriginal = (q: Question, answer: unknown, order: number[] | undefined): unknown => {
  if (!order) return answer;
  if (q.type === 'single') return typeof answer === 'number' ? order[answer] : answer;
  if (q.type === 'multi') return Array.isArray(answer) ? answer.map((i) => (typeof i === 'number' ? order[i] : i)) : answer;
  return answer;
};

export const gradeTest = (test: Test, answers: Record<string, unknown>, seed?: string) => {
  const v = seed === undefined ? null : variantOf(test, seed);
  const questions = v ? v.questions : test.questions;
  let score = 0;
  let maxScore = 0;
  const details = questions.map((q) => {
    const points = q.points > 0 ? q.points : 1;
    maxScore += points;
    const correct = checkQuestion(q, toOriginal(q, answers[q.id], v?.optionOrder[q.id]));
    if (correct) score += points;
    return { id: q.id, correct };
  });
  const percent = maxScore ? Math.round((score / maxScore) * 100) : 0;
  return { score, maxScore, percent, details };
};

/* тест для учащегося: без правильных ответов и пояснений, в порядке его варианта */
export const studentView = (test: Test, seed: string) => {
  const v = variantOf(test, seed);
  return {
    ...test,
    questions: v.questions.map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      points: q.points,
      ...(q.image ? { image: q.image } : {}),
      options: q.type === 'order' ? v.display[q.id]! : v.optionOrder[q.id] ? v.optionOrder[q.id]!.map((i) => q.options[i]!) : q.options,
      pairs: q.type === 'match' ? v.display[q.id]! : [],
    })),
  };
};

/* правильный ответ для разбора — в том виде, в каком задание видел учащийся */
export const correctFor = (q: Question, v: TestVariant): (string | number)[] => {
  if (q.type === 'match') return q.pairs;
  if (q.type === 'order') return q.options;
  const order = v.optionOrder[q.id];
  if (order && (q.type === 'single' || q.type === 'multi')) return q.answer.map((a) => order.indexOf(Number(a)));
  return q.answer;
};
