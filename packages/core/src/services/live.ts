/* «Опрос на занятии»: преподаватель выводит вопрос на экран, учащиеся группы отвечают со своих устройств,
   распределение ответов обновляется сразу. Без баллов и рейтингов — ответы группы, правильный ответ и пояснение.
   Опрос живёт в памяти, пока идёт занятие (три часа), и в базу не записывается */
import { alive, getAlive, needRole, needUser, notify, type Ctx } from '../context.ts';
import { bad, forbidden, notFound } from '../errors.ts';
import { fullName, shortName, type Question } from '../model.ts';
import { canViewCourseAsStaff, isStaff } from '../roles.ts';
import { idOf, obj, oneOf } from '../validate.ts';

interface Live {
  id: string;
  institutionId: string | null;
  teacherId: string;
  teacher: string;
  groupId: string;
  group: string;
  testId: string;
  courseId: string;
  title: string;
  questions: Question[];
  index: number;
  reveal: boolean;
  finished: boolean;
  startedAt: number;
  students: string[];
  joined: Set<string>;
  /* ответы по заданиям: учащийся → выбранные варианты */
  answers: Map<string, Map<string, number[]>>;
}

const sessions = new Map<string, Live>();
const TTL = 3 * 3_600_000;

/* в опросе — задания с выбором ответа: их удобно показать на экране и ответить с телефона */
export const liveQuestions = (qs: Question[]) => qs.filter((q) => (q.type === 'single' || q.type === 'multi') && q.options.length >= 2 && q.text.trim());

const sweep = (now: number) => {
  for (const [id, s] of sessions) if (now - s.startedAt > TTL) sessions.delete(id);
};

const audience = (s: Live) => [...s.students, s.teacherId];
const ping = (ctx: Ctx, s: Live, who = audience(s)) => ctx.events.publish(who, { type: 'live', data: { id: s.id } });

const sessionFor = (ctx: Ctx, id: string) => {
  sweep(ctx.now().getTime());
  const s = sessions.get(id);
  if (!s) throw notFound('Опрос');
  const u = needUser(ctx);
  if (u.id !== s.teacherId && !s.students.includes(u.id) && !(isStaff(u) && u.institutionId === s.institutionId)) throw forbidden();
  return { s, u };
};

export const startLive = async (ctx: Ctx, input: unknown) => {
  const u = needRole(ctx, 'owner', 'director', 'methodist', 'teacher');
  const b = obj(input);
  const test = await getAlive(ctx, 'tests', idOf(b.testId, 'Тест'), 'Тест');
  const mod = await getAlive(ctx, 'modules', test.moduleId, 'Модуль');
  const course = await getAlive(ctx, 'courses', mod.courseId, 'Курс');
  if (!canViewCourseAsStaff(u, course)) throw forbidden();
  const group = await getAlive(ctx, 'groups', idOf(b.groupId, 'Группа'), 'Группа');
  if (u.role !== 'owner' && group.institutionId !== u.institutionId) throw forbidden();
  const questions = liveQuestions(test.questions);
  if (!questions.length) throw bad('В тесте нет заданий с выбором ответа — их можно показать в опросе');
  const students = alive(await ctx.repo.find('groupMembers', { groupId: group.id })).map((m) => m.studentId);
  if (!students.length) throw bad('В группе пока нет учащихся');
  /* у преподавателя одновременно идёт один опрос */
  for (const [id, s] of sessions) if (s.teacherId === u.id && !s.finished) sessions.delete(id);
  const s: Live = {
    id: ctx.id(),
    institutionId: group.institutionId,
    teacherId: u.id,
    teacher: shortName(u),
    groupId: group.id,
    group: group.name,
    testId: test.id,
    courseId: course.id,
    title: mod.title,
    questions,
    index: 0,
    reveal: false,
    finished: false,
    startedAt: ctx.now().getTime(),
    students,
    joined: new Set(),
    answers: new Map(questions.map((q) => [q.id, new Map()])),
  };
  sessions.set(s.id, s);
  await notify(ctx, students, 'Опрос на занятии', `**«${mod.title}»**\nПреподаватель: ${fullName(u)}\nОткройте опрос и ответьте со своего устройства.`, `/live/${s.id}`);
  ping(ctx, s);
  return { id: s.id };
};

/* идущий опрос: учащемуся — по его группам, сотруднику — его собственный.
   Ответ всегда объект: сервер заменяет пустой ответ на { ok: true } */
export const activeLive = async (ctx: Ctx) => {
  const u = needUser(ctx);
  sweep(ctx.now().getTime());
  const s = [...sessions.values()].filter((x) => !x.finished && (x.teacherId === u.id || x.students.includes(u.id))).sort((a, b) => b.startedAt - a.startedAt)[0];
  return { live: s ? { id: s.id, title: s.title, teacher: s.teacher, group: s.group, mine: s.teacherId === u.id } : null };
};

const counts = (s: Live, q: Question) => {
  const c = q.options.map(() => 0);
  for (const a of s.answers.get(q.id)?.values() ?? []) for (const i of a) if (i >= 0 && i < c.length) c[i]! += 1;
  return c;
};

const isRight = (q: Question, a: number[]) => {
  const key = q.answer.map(Number);
  return a.length === key.length && a.every((x) => key.includes(x));
};

export const getLive = async (ctx: Ctx, id: string) => {
  const { s, u } = sessionFor(ctx, id);
  const q = s.questions[s.index]!;
  const answered = s.answers.get(q.id)?.size ?? 0;
  const head = { id: s.id, title: s.title, group: s.group, teacher: s.teacher, index: s.index, total: s.questions.length, reveal: s.reveal, finished: s.finished, answered, members: s.students.length, joined: s.joined.size };
  const summary = s.finished
    ? s.questions.map((x, i) => {
        const all = [...(s.answers.get(x.id)?.values() ?? [])];
        return { n: i + 1, text: x.text, answered: all.length, right: all.filter((a) => isRight(x, a)).length };
      })
    : null;
  if (u.id === s.teacherId || isStaff(u)) {
    return { ...head, role: 'teacher' as const, question: { id: q.id, type: q.type, text: q.text, options: q.options, answer: q.answer.map(Number), explain: q.explain }, counts: counts(s, q), summary };
  }
  const mine = s.answers.get(q.id)?.get(u.id) ?? null;
  return {
    ...head,
    role: 'student' as const,
    question: { id: q.id, type: q.type, text: q.text, options: q.options, ...(s.reveal ? { answer: q.answer.map(Number), explain: q.explain } : {}) },
    mine,
    right: s.reveal && mine ? isRight(q, mine) : null,
    counts: s.reveal ? counts(s, q) : null,
    summary: summary
      ? summary.map((x, i) => {
          const a = s.answers.get(s.questions[i]!.id)?.get(u.id);
          return { ...x, mine: a ? isRight(s.questions[i]!, a) : null };
        })
      : null,
  };
};

export const joinLive = async (ctx: Ctx, id: string) => {
  const { s, u } = sessionFor(ctx, id);
  if (!s.students.includes(u.id)) return { ok: true };
  if (!s.joined.has(u.id)) {
    s.joined.add(u.id);
    ping(ctx, s, [s.teacherId]);
  }
  return { ok: true };
};

export const answerLive = async (ctx: Ctx, id: string, input: unknown) => {
  const { s, u } = sessionFor(ctx, id);
  if (!s.students.includes(u.id)) throw forbidden('Отвечают учащиеся группы');
  if (s.finished) throw bad('Опрос завершён');
  if (s.reveal) throw bad('Ответ уже показан — дождитесь следующего вопроса');
  const q = s.questions[s.index]!;
  const b = obj(input);
  if (b.questionId !== q.id) throw bad('Преподаватель уже перешёл к другому вопросу');
  const raw = Array.isArray(b.answer) ? b.answer : [b.answer];
  const picks = [...new Set(raw.filter((x): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < q.options.length))];
  if (!picks.length) throw bad('Выберите ответ');
  if (q.type === 'single' && picks.length > 1) throw bad('Выберите один ответ');
  s.joined.add(u.id);
  s.answers.get(q.id)!.set(u.id, picks);
  ping(ctx, s, [s.teacherId]);
  return { ok: true };
};

export const controlLive = async (ctx: Ctx, id: string, input: unknown) => {
  const { s, u } = sessionFor(ctx, id);
  if (u.id !== s.teacherId) throw forbidden('Опросом управляет преподаватель, который его начал');
  const action = oneOf(obj(input).action, 'Действие', ['reveal', 'next', 'prev', 'finish'] as const);
  if (action === 'reveal') s.reveal = true;
  if (action === 'next' && s.index < s.questions.length - 1) {
    s.index++;
    s.reveal = false;
  }
  if (action === 'prev' && s.index > 0) {
    s.index--;
    s.reveal = true;
  }
  if (action === 'finish') {
    s.finished = true;
    s.reveal = true;
  }
  ping(ctx, s);
  return { ok: true };
};
