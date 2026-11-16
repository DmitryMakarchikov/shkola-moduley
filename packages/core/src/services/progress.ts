/* успеваемость групп: сводка для куратора, преподавателя, методиста и директора */
import { alive, audit, getAlive, needRole, notify, type Ctx } from '../context.ts';
import { forbidden } from '../errors.ts';
import { fullName, shortName, type Assignment, type Group, type Lab, type Lecture, type Test, type User } from '../model.ts';
import type { Ports } from '../ports.ts';
import { ROLE_LABEL } from '../roles.ts';

const DAY = 86_400_000;
const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

const LECTURE_HEAVY: (keyof Lecture)[] = ['blocks'];
const TEST_HEAVY: (keyof Test)[] = ['questions'];
const LAB_HEAVY: (keyof Lab)[] = ['blocks', 'description', 'variants', 'criteria', 'diagramReference', 'controlQuestions', 'templateFileIds'];

export type ItemKind = 'lecture' | 'test' | 'lab';
interface Item {
  kind: ItemKind;
  id: string;
  title: string;
  courseId: string;
  course: string;
  module: string;
  due: string | null;
  pass: number;
  /* тест не пускает дальше, пока не сдан; limit — число попыток (0 — без ограничений) */
  gate?: boolean;
  limit?: number;
}

/* какие группы видит сотрудник: директор и методист — все группы учреждения, куратор — свою группу целиком,
   преподаватель — группы, где ведёт курс, и только свои курсы */
const scopeOf = async (ctx: Ctx, u: User) => {
  const groups = alive(await ctx.repo.all('groups'));
  const assignments = alive(await ctx.repo.all('assignments'));
  const out: { group: Group; assignments: Assignment[]; curated: boolean }[] = [];
  for (const g of groups) {
    const curated = g.curatorId === u.id;
    let all = false;
    let mine = false;
    if (u.role === 'owner') all = true;
    else if ((u.role === 'director' || u.role === 'methodist') && g.institutionId === u.institutionId) all = true;
    else if (u.role === 'teacher' && g.institutionId === u.institutionId) {
      all = curated;
      mine = assignments.some((a) => a.groupId === g.id && a.teacherId === u.id);
    }
    if (!all && !mine) continue;
    out.push({ group: g, assignments: assignments.filter((a) => a.groupId === g.id && (all || a.teacherId === u.id)), curated });
  }
  return out.sort((a, b) => Number(b.curated) - Number(a.curated) || a.group.name.localeCompare(b.group.name, 'ru'));
};

/* группы, успеваемость которых пользователь может открыть (для ссылок из поиска) */
export const progressScope = async (ctx: Ctx, u: User) => new Set((await scopeOf(ctx, u)).map((s) => s.group.id));

/* всё, что нужно для сводки по группе: учащиеся, задания курсов со сроками и результаты */
const collect = async (ctx: Ctx, g: Group, asg: Assignment[]) => {
  const members = alive(await ctx.repo.find('groupMembers', { groupId: g.id }));
  const students = (await ctx.repo.list('users', 'id', members.map((m) => m.studentId), ['passwordHash']))
    .filter((s) => !s.deletedAt)
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'));
  const items: Item[] = [];
  const courses: { id: string; title: string; teacher: string; assignmentId: string }[] = [];
  for (const a of asg) {
    const course = await ctx.repo.get('courses', a.courseId);
    if (!course || course.deletedAt) continue;
    const teacher = await ctx.repo.get('users', a.teacherId);
    courses.push({ id: course.id, title: course.title, teacher: teacher ? fullName(teacher) : '', assignmentId: a.id });
    const modules = alive(await ctx.repo.find('modules', { courseId: course.id })).sort(byPos);
    const ids = modules.map((m) => m.id);
    const lectures = alive(await ctx.repo.list('lectures', 'moduleId', ids, LECTURE_HEAVY));
    const tests = alive(await ctx.repo.list('tests', 'moduleId', ids, TEST_HEAVY)).filter((t) => !t.settings.draft);
    const labs = alive(await ctx.repo.list('labs', 'moduleId', ids, LAB_HEAVY));
    for (const m of modules) {
      const base = { courseId: course.id, course: course.title, module: m.title };
      for (const l of lectures.filter((x) => x.moduleId === m.id).sort(byPos)) items.push({ ...base, kind: 'lecture', id: l.id, title: l.title, due: null, pass: 0 });
      for (const t of tests.filter((x) => x.moduleId === m.id).sort(byPos)) items.push({ ...base, kind: 'test', id: t.id, title: t.title, due: a.dueDates[t.id] ?? null, pass: t.settings.passPercent, gate: t.settings.gate ?? t.settings.mode !== 'control', limit: t.settings.attempts });
      for (const l of labs.filter((x) => x.moduleId === m.id).sort(byPos)) items.push({ ...base, kind: 'lab', id: l.id, title: l.title, due: a.dueDates[l.id] ?? null, pass: 0 });
    }
  }
  const sids = new Set(students.map((s) => s.id));
  const of = (k: ItemKind) => items.filter((i) => i.kind === k).map((i) => i.id);
  const views = (await ctx.repo.list('lectureViews', 'lectureId', of('lecture'))).filter((v) => sids.has(v.userId));
  const attempts = (await ctx.repo.list('attempts', 'testId', of('test'), ['answers', 'details'])).filter((a) => sids.has(a.studentId));
  const subs = (await ctx.repo.list('submissions', 'labId', of('lab'), ['diagram'])).filter((s) => sids.has(s.studentId) && !s.deletedAt);
  return { students, items, courses, views, attempts, subs };
};

type Data = Awaited<ReturnType<typeof collect>>;

/* результаты одного учащегося по всем заданиям группы */
const studentRow = (ctx: Ctx, d: Data, s: User) => {
  const now = ctx.now().toISOString();
  const soon = new Date(ctx.now().getTime() + 3 * DAY).toISOString();
  const viewed = new Set(d.views.filter((v) => v.userId === s.id).map((v) => v.lectureId));
  const best = new Map<string, number>();
  for (const a of d.attempts) if (a.studentId === s.id) best.set(a.testId, Math.max(best.get(a.testId) ?? 0, a.percent));
  const last = new Map<string, (typeof d.subs)[number]>();
  for (const x of d.subs) if (x.studentId === s.id && (!last.get(x.labId) || last.get(x.labId)!.version < x.version)) last.set(x.labId, x);
  const debts: { kind: ItemKind; id: string; title: string; course: string; due: string; days: number; status: string }[] = [];
  const upcoming: { kind: ItemKind; id: string; title: string; course: string; due: string }[] = [];
  const perCourse = new Map<string, { done: number; total: number; grades: number[]; debts: number }>();
  let done = 0;
  let dueTotal = 0;
  let dueDone = 0;
  const grades: number[] = [];
  const percents: number[] = [];
  let pending = 0;
  let late = 0;
  let blockedBy: string | null = null;
  for (const it of d.items) {
    const c = perCourse.get(it.courseId) ?? { done: 0, total: 0, grades: [], debts: 0 };
    perCourse.set(it.courseId, c);
    c.total++;
    let ok = false;
    let status = 'не начато';
    if (it.kind === 'lecture') ok = viewed.has(it.id);
    if (it.kind === 'test') {
      const b = best.get(it.id);
      if (b !== undefined) percents.push(b);
      ok = b !== undefined && b >= it.pass;
      status = b === undefined ? 'не пройден' : `${b}% — ниже порога ${it.pass}%`;
      const tries = d.attempts.filter((a) => a.studentId === s.id && a.testId === it.id).length;
      if (!blockedBy && it.gate && b !== undefined && !ok && (!it.limit || tries < it.limit)) blockedBy = it.title;
    }
    if (it.kind === 'lab') {
      const x = last.get(it.id);
      if (x?.status === 'graded' && x.grade) {
        grades.push(x.grade);
        c.grades.push(x.grade);
      }
      if (x?.status === 'submitted') pending++;
      if (x?.late) late++;
      ok = x?.status === 'graded' || x?.status === 'submitted';
      status = !x ? 'не сдана' : x.status === 'returned' ? 'возвращена на доработку' : x.status;
    }
    if (it.due && it.due < now) {
      dueTotal++;
      if (ok) dueDone++;
    }
    if (ok) {
      done++;
      c.done++;
    } else if (it.due && it.due < now) {
      debts.push({ kind: it.kind, id: it.id, title: it.title, course: it.course, due: it.due, days: Math.max(1, Math.round((ctx.now().getTime() - new Date(it.due).getTime()) / DAY)), status });
      c.debts++;
    } else if (it.due && it.due <= soon) {
      upcoming.push({ kind: it.kind, id: it.id, title: it.title, course: it.course, due: it.due });
    }
  }
  const stamps = [...d.views.filter((v) => v.userId === s.id), ...d.attempts.filter((a) => a.studentId === s.id), ...d.subs.filter((x) => x.studentId === s.id)].map((r) => r.createdAt);
  const lastActive = stamps.length ? stamps.sort().at(-1)! : null;
  const idle = lastActive ? Math.floor((ctx.now().getTime() - new Date(lastActive).getTime()) / DAY) : null;
  const average = avg(grades);
  const reasons: string[] = [];
  if (debts.length >= 3) reasons.push(`долгов: ${debts.length}`);
  if (average !== null && average < 5) reasons.push(`средний балл ${String(average).replace('.', ',')}`);
  if (blockedBy) reasons.push(`дальше не пускает тест «${blockedBy}»`);
  if (d.items.length && (idle === null || idle >= 14)) reasons.push(idle === null ? 'ещё не приступал к курсу' : `не заходил ${idle} дн.`);
  const level = reasons.length ? 'risk' : average !== null && average >= 9 && !debts.length ? 'top' : 'ok';
  return {
    id: s.id,
    name: fullName(s),
    progress: pct(done, d.items.length),
    /* выполнено в срок: доля заданий, срок которых уже наступил */
    plan: dueTotal ? pct(dueDone, dueTotal) : 100,
    average,
    testsAverage: avg(percents),
    graded: grades.length,
    pending,
    late,
    debts: debts.sort((a, b) => a.due.localeCompare(b.due)),
    upcoming: upcoming.sort((a, b) => a.due.localeCompare(b.due)),
    lastActive,
    level,
    reasons,
    courses: d.courses.map((c) => {
      const x = perCourse.get(c.id) ?? { done: 0, total: 0, grades: [], debts: 0 };
      return { id: c.id, progress: pct(x.done, x.total), average: avg(x.grades), debts: x.debts };
    }),
    telegram: !!s.telegramChatId,
  };
};

type Row = ReturnType<typeof studentRow>;

/* распределение средних отметок по десятибалльной шкале */
const distribution = (rows: Row[]) => {
  const out = { excellent: 0, good: 0, fair: 0, poor: 0, none: 0 };
  for (const r of rows) {
    if (r.average === null) out.none++;
    else if (r.average >= 9) out.excellent++;
    else if (r.average >= 7) out.good++;
    else if (r.average >= 5) out.fair++;
    else out.poor++;
  }
  return out;
};

const summary = (g: Group, rows: Row[], curator: string, curated: boolean, courses: Data['courses']) => {
  const withGrades = rows.filter((r) => r.average !== null);
  return {
    id: g.id,
    name: g.name,
    year: g.year,
    specialty: g.specialty,
    curator,
    curated,
    students: rows.length,
    courses: courses.map((c) => ({ id: c.id, title: c.title, teacher: c.teacher })),
    average: avg(withGrades.map((r) => r.average!)),
    progress: rows.length ? Math.round(rows.reduce((a, r) => a + r.progress, 0) / rows.length) : 0,
    plan: rows.length ? Math.round(rows.reduce((a, r) => a + r.plan, 0) / rows.length) : 100,
    testsAverage: avg(rows.filter((r) => r.testsAverage !== null).map((r) => r.testsAverage!)),
    debts: rows.reduce((a, r) => a + r.debts.length, 0),
    debtors: rows.filter((r) => r.debts.length).length,
    pending: rows.reduce((a, r) => a + r.pending, 0),
    risk: rows.filter((r) => r.level === 'risk').length,
    top: rows.filter((r) => r.level === 'top').length,
    distribution: distribution(rows),
  };
};

const curatorName = async (ctx: Ctx, g: Group) => {
  const c = g.curatorId ? await ctx.repo.get('users', g.curatorId) : undefined;
  return c && !c.deletedAt ? fullName(c) : '';
};

/* обзор всех доступных групп */
export const groupsProgress = async (ctx: Ctx) => {
  const u = needRole(ctx, 'owner', 'director', 'methodist', 'teacher');
  const out = [];
  for (const { group, assignments, curated } of await scopeOf(ctx, u)) {
    const d = await collect(ctx, group, assignments);
    const rows = d.students.map((s) => studentRow(ctx, d, s));
    out.push(summary(group, rows, await curatorName(ctx, group), curated, d.courses));
  }
  return out;
};

/* одна группа подробно: учащиеся, долги, курсы */
export const groupProgress = async (ctx: Ctx, groupId: string) => {
  const u = needRole(ctx, 'owner', 'director', 'methodist', 'teacher');
  const g = await getAlive(ctx, 'groups', groupId, 'Группа');
  const scope = (await scopeOf(ctx, u)).find((x) => x.group.id === g.id);
  if (!scope) throw forbidden('Успеваемость этой группы видят её куратор, преподаватели группы, методист и директор');
  const d = await collect(ctx, g, scope.assignments);
  const rows = d.students.map((s) => studentRow(ctx, d, s));
  return { group: summary(g, rows, await curatorName(ctx, g), scope.curated, d.courses), students: rows, canRemind: u.role !== 'methodist' };
};

/* «5 дней», «1 день», «3 дня» */
const daysText = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней'}`;
/* длинное название задания в списке уведомления — сокращаем */
const clip = (s: string, n = 72) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);

/* напомнить должникам: уведомление на сайте и в Telegram — списком, с числом дней просрочки */
export const remindDebtors = async (ctx: Ctx, groupId: string) => {
  const u = needRole(ctx, 'owner', 'director', 'teacher');
  const p = await groupProgress(ctx, groupId);
  const debtors = p.students.filter((s) => s.debts.length);
  const who = `${p.group.curated ? 'Куратор' : ROLE_LABEL[u.role]} ${shortName(u)}`;
  for (const s of debtors) {
    const lines = s.debts.slice(0, 6).map((x) => `• ${clip(x.title)} — просрочено на **${daysText(x.days)}**`);
    const more = s.debts.length > 6 ? `\n• и ещё ${s.debts.length - 6}` : '';
    await notify(ctx, [s.id], `Несданные задания: ${s.debts.length}`, `${who} напоминает о сроках:\n\n${lines.join('\n')}${more}\n\nСдайте работы как можно скорее — все задания со сроками есть на главной странице.`, '/');
  }
  await audit(ctx, 'remind', 'groups', groupId, `Напоминание должникам группы ${p.group.name}: ${debtors.length}`);
  return { sent: debtors.length };
};

/* для бота: группы, за которые пользователь отвечает (куратору — свои, директору и методисту — все) */
export const progressFor = async (ctx: Ctx) => (await groupsProgress(ctx)).filter((g) => g.curated || ctx.user?.role !== 'teacher');

export const itemLink = (kind: ItemKind, id: string) => `/learn/${kind}/${id}`;
const ddmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* напоминания по таймеру сервера: учащемуся — за сутки до срока, куратору — сводка новых долгов группы раз в сутки.
   Напоминание — обычное уведомление: оно видно на сайте и уходит в Telegram; повторно не отправляется */
export const remindDeadlines = async (ports: Ports) => {
  const ctx: Ctx = { ...ports, user: null, ip: 'system' };
  const now = ports.now().getTime();
  const tomorrow = new Date(now + DAY).toISOString();
  const dayAgo = new Date(now - DAY).toISOString();
  const assignments = alive(await ctx.repo.all('assignments'));
  let sent = 0;
  for (const g of alive(await ctx.repo.all('groups'))) {
    const asg = assignments.filter((a) => a.groupId === g.id);
    if (!asg.length) continue;
    const d = await collect(ctx, g, asg);
    const fresh: string[] = [];
    for (const s of d.students) {
      const row = studentRow(ctx, d, s);
      const mine = await ctx.repo.find('notifications', { userId: s.id });
      for (const x of row.upcoming.filter((u) => u.due <= tomorrow)) {
        const link = itemLink(x.kind, x.id);
        if (mine.some((n) => n.link === link && n.title.startsWith('Срок'))) continue;
        await notify(ctx, [s.id], 'Срок сдачи — меньше суток', `**«${x.title}»**\nКурс: ${x.course}\nСдать до: **${ddmm(x.due)}**`, link);
        sent++;
      }
      for (const x of row.debts.filter((u) => u.due >= dayAgo)) fresh.push(`**${row.name}** — ${clip(x.title, 60)}`);
    }
    if (fresh.length && g.curatorId) {
      const title = `Новые долги в группе ${g.name}`;
      const recent = (await ctx.repo.find('notifications', { userId: g.curatorId })).some((n) => n.title === title && n.createdAt >= dayAgo);
      if (!recent) {
        await notify(ctx, [g.curatorId], title, `За сутки не сдано в срок:\n${fresh.slice(0, 8).map((f) => `• ${f}`).join('\n')}${fresh.length > 8 ? `\n• и ещё ${fresh.length - 8}` : ''}`, `/progress/${g.id}`);
        sent++;
      }
    }
  }
  return sent;
};
