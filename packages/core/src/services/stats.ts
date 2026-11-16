/* анализ результатов теста для преподавателя: насколько трудно каждое задание, отличает ли оно знающих от незнающих,
   какие неверные ответы выбирают чаще всего и как меняется результат от первой попытки к лучшей.
   Показатели классической теории тестов (доля верных ответов, индекс дискриминации, KR-20) — в понятных словах */
import { alive, getAlive, needRole, type Ctx } from '../context.ts';
import { forbidden } from '../errors.ts';
import { gradeTest, seeded, variantOf, type TestVariant } from '../grading.ts';
import type { Attempt, Group, Question, Test } from '../model.ts';
import type { Ports } from '../ports.ts';
import { canViewCourseAsStaff } from '../roles.ts';
import { norm } from '../validate.ts';

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const share = (a: number, b: number) => (b ? Math.round((a / b) * 100) / 100 : null);

/* зерно варианта попытки — как при выдаче теста учащемуся */
const seedOf = (a: Attempt, k: number) => `${a.studentId}:${a.testId}:${k}`;

/* попытки каждого учащегося по порядку: номер попытки определяет его вариант */
const numbered = (attempts: Attempt[]) => {
  const by = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const list = by.get(a.studentId);
    if (list) list.push(a);
    else by.set(a.studentId, [a]);
  }
  for (const list of by.values()) list.sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id));
  return by;
};

const LEVEL = (p: number) => (p >= 0.85 ? 'лёгкое' : p >= 0.5 ? 'среднее' : p >= 0.25 ? 'трудное' : 'очень трудное');
/* шкала Эбела для индекса дискриминации */
const DISCR = (d: number) => (d >= 0.4 ? 'отлично различает' : d >= 0.3 ? 'хорошо различает' : d >= 0.2 ? 'различает удовлетворительно' : d >= 0 ? 'слабо различает' : 'сильные ошибаются чаще слабых');
const RELIABILITY = (r: number) => (r >= 0.8 ? 'высокая' : r >= 0.7 ? 'хорошая' : r >= 0.6 ? 'приемлемая' : 'низкая');

export const testStats = async (ctx: Ctx, testId: string, query: Record<string, string | undefined> = {}) => {
  const u = needRole(ctx, 'owner', 'director', 'methodist', 'teacher');
  const test = await getAlive(ctx, 'tests', testId, 'Тест');
  const mod = await getAlive(ctx, 'modules', test.moduleId, 'Модуль');
  const course = await getAlive(ctx, 'courses', mod.courseId, 'Курс');
  if (!canViewCourseAsStaff(u, course)) throw forbidden();

  /* группы: преподаватель — где ведёт этот курс или куратор, остальные сотрудники — все группы с этим курсом */
  const asg = alive(await ctx.repo.find('assignments', { courseId: course.id }));
  const groups: Group[] = [];
  for (const a of asg) {
    const g = await ctx.repo.get('groups', a.groupId);
    if (!g || g.deletedAt || groups.some((x) => x.id === g.id)) continue;
    if (u.role === 'teacher' && a.teacherId !== u.id && g.curatorId !== u.id) continue;
    if (u.role !== 'owner' && g.institutionId !== u.institutionId) continue;
    groups.push(g);
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const chosen = query.groupId ? groups.filter((g) => g.id === query.groupId) : groups;
  const members = new Set(alive(await ctx.repo.list('groupMembers', 'groupId', chosen.map((g) => g.id))).map((m) => m.studentId));

  const by = numbered(alive(await ctx.repo.find('attempts', { testId })));
  const rows: { a: Attempt; k: number }[] = [];
  for (const [sid, list] of by) if (members.has(sid)) list.forEach((a, k) => rows.push({ a, k }));

  /* сводка: по учащимся — первая и лучшая попытка */
  const students = [...new Set(rows.map((r) => r.a.studentId))];
  const first = students.map((s) => by.get(s)![0]!.percent);
  const best = students.map((s) => Math.max(...by.get(s)!.map((a) => a.percent)));
  const pass = test.settings.passPercent;
  const dist = Array.from({ length: 10 }, () => 0);
  for (const p of best) dist[Math.min(9, Math.floor(p / 10))]! += 1;
  const avgFirst = mean(first);
  const avgBest = mean(best);

  /* задания: только попытки с сохранёнными ответами */
  const graded = rows.filter((r) => r.a.details?.length);
  const sorted = [...graded].sort((x, y) => y.a.percent - x.a.percent);
  const g27 = Math.max(1, Math.round(sorted.length * 0.27));
  const top = new Set(sorted.slice(0, g27).map((r) => r.a.id));
  const bottom = new Set(sorted.slice(-g27).map((r) => r.a.id));
  /* вариант попытки нужен, чтобы перевести номер варианта ответа учащегося в исходный */
  const variants = new Map<string, TestVariant | null>();
  const variantFor = (r: { a: Attempt; k: number }) => {
    if (!variants.has(r.a.id)) {
      const v = variantOf(test, seedOf(r.a, r.k));
      /* если задания теста меняли после попытки, вариант уже не восстановить */
      const same = v.questions.length === r.a.details.length && v.questions.every((q) => r.a.details.some((d) => d.id === q.id));
      variants.set(r.a.id, same ? v : null);
    }
    return variants.get(r.a.id) ?? null;
  };

  const questions = test.questions.map((q, n) => {
    let shown = 0;
    let ok = 0;
    let tShown = 0;
    let tOk = 0;
    let bShown = 0;
    let bOk = 0;
    let blank = 0;
    const opts = q.options.map(() => 0);
    let mapped = 0;
    const wrongShort = new Map<string, { text: string; count: number }>();
    for (const r of graded) {
      const d = r.a.details.find((x) => x.id === q.id);
      if (!d) continue;
      shown++;
      if (d.correct) ok++;
      if (top.has(r.a.id)) {
        tShown++;
        if (d.correct) tOk++;
      }
      if (bottom.has(r.a.id)) {
        bShown++;
        if (d.correct) bOk++;
      }
      const ans = r.a.answers?.[q.id];
      if (ans === undefined || ans === null || ans === '' || (Array.isArray(ans) && !ans.length)) {
        blank++;
        continue;
      }
      if (q.type === 'single' || q.type === 'multi') {
        const v = variantFor(r);
        if (!v) continue;
        const order = v.optionOrder[q.id];
        mapped++;
        for (const x of Array.isArray(ans) ? ans : [ans]) {
          if (typeof x !== 'number') continue;
          const i = order ? order[x] : x;
          if (i !== undefined && i >= 0 && i < opts.length) opts[i]! += 1;
        }
      } else if (q.type === 'short' && !d.correct && typeof ans === 'string') {
        const key = norm(ans);
        const w = wrongShort.get(key);
        if (w) w.count++;
        else wrongShort.set(key, { text: ans.trim(), count: 1 });
      }
    }
    const p = shown ? ok / shown : null;
    /* различающую способность по нескольким ответам не оцениваем: слишком велика случайность */
    const d = shown >= 8 && tShown && bShown ? Math.round((tOk / tShown - bOk / bShown) * 100) / 100 : null;
    /* что сделать преподавателю */
    const advice: string[] = [];
    const key = q.type === 'single' ? Number(q.answer[0]) : -1;
    const fav = q.type === 'single' ? opts.reduce((m, c, i) => (i !== key && c > (opts[m] ?? -1) ? i : m), key === 0 ? 1 : 0) : -1;
    if (d !== null && d < 0 && shown >= 8) advice.push('Проверьте ключ и формулировку: сильные учащиеся ошибаются чаще слабых.');
    if (q.type === 'single' && mapped >= 8 && fav >= 0 && fav !== key && (opts[fav] ?? 0) > (opts[key] ?? 0)) advice.push(`Неверный вариант «${q.options[fav]}» выбирают чаще верного: проверьте ключ или разберите этот вопрос на занятии.`);
    if (p !== null && shown >= 5 && p < 0.25) advice.push('Очень трудное: вернитесь к теме на занятии или уточните формулировку.');
    if (p !== null && shown >= 10 && p >= 0.95) advice.push('Почти все отвечают верно: задание мало что проверяет, его можно усложнить.');
    if (d !== null && d >= 0 && d < 0.2 && shown >= 10 && !(p !== null && p >= 0.95)) advice.push('Слабо различает знающих и незнающих: уточните формулировку или неверные варианты.');
    if (shown >= 5 && blank / shown >= 0.3) advice.push('Часто остаётся без ответа: возможно, непонятно, как отвечать.');
    return {
      id: q.id,
      n: n + 1,
      type: q.type,
      text: q.text,
      options: q.options,
      pairs: q.pairs,
      answer: q.answer,
      shown,
      correct: ok,
      p: p === null ? null : Math.round(p * 100) / 100,
      d,
      level: p === null ? null : LEVEL(p),
      discr: d === null ? null : DISCR(d),
      opts: q.type === 'single' || q.type === 'multi' ? opts : [],
      mapped,
      blank,
      wrong: [...wrongShort.values()].sort((a, b) => b.count - a.count).slice(0, 3),
      advice,
    };
  });

  /* надёжность (KR-20): когда все учащиеся получают одни и те же задания и данных достаточно —
     на коротком тесте и нескольких попытках показатель случаен, поэтому его не считаем */
  let reliability: number | null = null;
  const k = test.questions.length;
  const full = graded.filter((r) => r.a.details.length === k);
  if (k >= 10 && full.length >= 20 && !(test.settings.pick && test.settings.pick < k)) {
    const totals = full.map((r) => r.a.details.filter((x) => x.correct).length);
    const m = totals.reduce((a, b) => a + b, 0) / totals.length;
    const variance = totals.reduce((a, b) => a + (b - m) ** 2, 0) / totals.length;
    const pq = test.questions.reduce((s, q) => {
      const c = full.filter((r) => r.a.details.find((x) => x.id === q.id)?.correct).length / full.length;
      return s + c * (1 - c);
    }, 0);
    if (variance > 0) reliability = Math.round((k / (k - 1)) * (1 - pq / variance) * 100) / 100;
  }

  return {
    test: { id: test.id, title: test.title, pass, mode: test.settings.mode, bank: k, pick: test.settings.pick ?? 0 },
    module: { id: mod.id, title: mod.title },
    course: { id: course.id, title: course.title },
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    groupId: query.groupId ?? null,
    summary: {
      members: members.size,
      students: students.length,
      attempts: rows.length,
      analyzed: graded.length,
      avgFirst,
      avgBest,
      gain: avgFirst !== null && avgBest !== null ? avgBest - avgFirst : null,
      passed: best.filter((p) => p >= pass).length,
      passRate: share(best.filter((p) => p >= pass).length, best.length),
      dist,
      reliability,
      reliabilityText: reliability === null ? null : RELIABILITY(reliability),
    },
    questions,
  };
};

/* ---------- демонстрационные ответы ---------- */
/* у демонстрационных попыток нет ответов по заданиям (только итоговый процент). Заполняем их так, чтобы итог почти не изменился,
   а сдан/не сдан — не изменился совсем: тогда анализ заданий показывает живую картину. Попытки с настоящими ответами не трогаем */
export const fillDemoAnswers = async (ports: Ports) => {
  const attempts = alive(await ports.repo.all('attempts'));
  const empty = attempts.filter((a) => !a.details?.length && !Object.keys(a.answers ?? {}).length);
  if (!empty.length) return 0;
  const tests = new Map((await ports.repo.all('tests')).map((t) => [t.id, t]));
  const by = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const key = `${a.studentId}:${a.testId}`;
    const list = by.get(key);
    if (list) list.push(a);
    else by.set(key, [a]);
  }
  for (const list of by.values()) list.sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id));
  let n = 0;
  for (const a of empty) {
    const t = tests.get(a.testId);
    if (!t || !t.questions.length) continue;
    const k = by.get(`${a.studentId}:${a.testId}`)!.indexOf(a);
    const seed = seedOf(a, k);
    const answers = demoAnswers(t, variantOf(t, seed), a);
    const r = gradeTest(t, answers, seed);
    await ports.repo.update('attempts', a.id, { answers, score: r.score, maxScore: r.maxScore, percent: r.percent, details: r.details });
    n++;
  }
  return n;
};

const demoAnswers = (t: Test, v: TestVariant, a: Attempt) => {
  const qs = v.questions;
  const pts = qs.map((q) => (q.points > 0 ? q.points : 1));
  const total = pts.reduce((x, y) => x + y, 0);
  const pass = t.settings.passPercent;
  /* у каждого задания своя трудность; чем легче задание, тем раньше оно попадает в число верных */
  const ease = qs.map((q) => 0.3 + 0.65 * seeded(`ease:${q.id}`)());
  const rnd = seeded(`demo:${a.id}`);
  const ranked = qs
    .map((_, i) => ({ i, key: Math.pow(rnd(), 1 / Math.max(0.05, ease[i]! ** 2)) }))
    .sort((x, y) => y.key - x.key)
    .map((x) => x.i);
  let count = 0;
  let diff = Infinity;
  for (let c = 0; c <= qs.length; c++) {
    const sc = ranked.slice(0, c).reduce((s, i) => s + pts[i]!, 0);
    const p = Math.round((sc / total) * 100);
    if (p >= pass !== a.percent >= pass) continue;
    if (Math.abs(p - a.percent) < diff) {
      diff = Math.abs(p - a.percent);
      count = c;
    }
  }
  const right = new Set(ranked.slice(0, count));
  const answers: Record<string, unknown> = {};
  qs.forEach((q, i) => {
    answers[q.id] = right.has(i) ? correctAnswer(q, v) : wrongAnswer(t, q, v, seeded(`wrong:${a.id}:${q.id}`));
  });
  return answers;
};

/* номер варианта ответа так, как его видел учащийся */
const shownIndex = (q: Question, v: TestVariant, orig: number) => {
  const order = v.optionOrder[q.id];
  return order ? order.indexOf(orig) : orig;
};

const correctAnswer = (q: Question, v: TestVariant): unknown => {
  switch (q.type) {
    case 'single':
      return shownIndex(q, v, Number(q.answer[0]));
    case 'multi':
      return q.answer.map((x) => shownIndex(q, v, Number(x)));
    case 'order':
      return [...q.options];
    case 'match':
      return [...q.pairs];
    default:
      return String(q.answer[0] ?? '');
  }
};

const wrongAnswer = (t: Test, q: Question, v: TestVariant, r: () => number): unknown => {
  const swap = (xs: string[]) => {
    const x = [...xs];
    if (x.length < 2) return x;
    const i = Math.floor(r() * (x.length - 1));
    [x[i], x[i + 1]] = [x[i + 1]!, x[i]!];
    return x;
  };
  switch (q.type) {
    case 'single': {
      const key = Number(q.answer[0]);
      const others = q.options.map((_, i) => i).filter((i) => i !== key);
      if (!others.length) return null;
      /* у задания есть «популярный» неверный вариант — как в жизни */
      const fav = others[Math.floor(seeded(`fav:${q.id}`)() * others.length)]!;
      return shownIndex(q, v, r() < 0.55 ? fav : others[Math.floor(r() * others.length)]!);
    }
    case 'multi': {
      const ans = q.answer.map(Number);
      const others = q.options.map((_, i) => i).filter((i) => !ans.includes(i));
      const set = [...ans];
      if (ans.length > 1 && (r() < 0.5 || !others.length)) set.splice(Math.floor(r() * set.length), 1);
      else if (others.length) set.push(others[Math.floor(r() * others.length)]!);
      else return [];
      return set.map((i) => shownIndex(q, v, i));
    }
    case 'order':
      return swap(q.options);
    case 'match':
      return swap(q.pairs);
    case 'short': {
      /* путают с ответом соседнего задания или оставляют пустым */
      const pool = t.questions.filter((x) => x.type === 'short' && x.id !== q.id).map((x) => String(x.answer[0] ?? '')).filter(Boolean);
      return pool.length && r() < 0.5 ? pool[Math.floor(r() * pool.length)]! : '';
    }
    default:
      return '';
  }
};
