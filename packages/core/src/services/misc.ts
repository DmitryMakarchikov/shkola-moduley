/* уведомления, журнал действий, корзина, сводка, файлы */
import { alive, audit, base, getAlive, joinCode, needRole, needUser, strongCode, touch, type Ctx } from '../context.ts';
import { bad, forbidden, notFound } from '../errors.ts';
import { fullName, type Base, type FileRow, type Table, type User } from '../model.ts';
import type { Ports } from '../ports.ts';
import { ROLE_LABEL, isStaff } from '../roles.ts';
import { norm, oneOf, str } from '../validate.ts';
import { listSubmissions, myCourseViews, nextStep, stepsOf } from './learn.ts';
import { fillDemoAnswers } from './stats.ts';

const TRASH_DAYS = 30;
const DAY = 86_400_000;

/* ---------- уведомления ---------- */
export const listNotifications = async (ctx: Ctx) => {
  const u = needUser(ctx);
  const rows = (await ctx.repo.find('notifications', { userId: u.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { unread: rows.filter((n) => !n.readAt).length, items: rows.slice(0, 50) };
};

export const readNotification = async (ctx: Ctx, id: string) => {
  const u = needUser(ctx);
  const n = await ctx.repo.get('notifications', id);
  if (!n || n.userId !== u.id) throw notFound('Уведомление');
  if (!n.readAt) await ctx.repo.update('notifications', id, { readAt: ctx.now().toISOString() });
  return { ok: true };
};

export const readAllNotifications = async (ctx: Ctx) => {
  const u = needUser(ctx);
  const t = ctx.now().toISOString();
  for (const n of await ctx.repo.find('notifications', { userId: u.id })) if (!n.readAt) await ctx.repo.update('notifications', n.id, { readAt: t });
  return { ok: true };
};

/* ---------- журнал действий ---------- */
export const listAudit = async (ctx: Ctx, query: Record<string, string | undefined> = {}) => {
  const u = needRole(ctx, 'owner', 'director');
  const users = new Map((await ctx.repo.all('users')).map((x) => [x.id, x]));
  let rows = await ctx.repo.all('audit');
  if (u.role !== 'owner') rows = rows.filter((a) => a.institutionId === u.institutionId);
  if (query.entity) rows = rows.filter((a) => a.entity === query.entity);
  if (query.q) {
    const q = norm(query.q);
    rows = rows.filter((a) => norm(`${a.summary} ${users.get(a.actorId) ? fullName(users.get(a.actorId)!) : ''}`).includes(q));
  }
  return rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 300)
    .map((a) => {
      const actor = users.get(a.actorId);
      return { ...a, actorName: actor ? fullName(actor) : 'Система', actorRole: actor ? ROLE_LABEL[actor.role] : '' };
    });
};

/* ---------- корзина ---------- */
const TRASH_TABLES = ['users', 'departments', 'groups', 'disciplines', 'courses', 'sections', 'modules', 'lectures', 'tests', 'labs', 'assignments'] as const;
type TrashTable = (typeof TRASH_TABLES)[number];
const TRASH_LABEL: Record<TrashTable, string> = {
  users: 'Пользователь',
  departments: 'Отделение',
  groups: 'Группа',
  disciplines: 'Дисциплина',
  courses: 'Курс',
  sections: 'Раздел',
  modules: 'Модуль',
  lectures: 'Лекция',
  tests: 'Тест',
  labs: 'Лабораторная работа',
  assignments: 'Назначение курса',
};

/* учреждение и курс записи — чтобы проверить, кто может её восстановить */
const ownerInfo = async (ctx: Ports, table: TrashTable, row: Record<string, unknown>) => {
  const courseOf = async (courseId: unknown) => (typeof courseId === 'string' ? await ctx.repo.get('courses', courseId) : undefined);
  const moduleCourse = async (moduleId: unknown) => {
    const m = typeof moduleId === 'string' ? await ctx.repo.get('modules', moduleId) : undefined;
    return m ? courseOf(m.courseId) : undefined;
  };
  let course;
  if (table === 'courses') course = row as never;
  else if (table === 'sections' || table === 'modules' || table === 'assignments') course = await courseOf(row.courseId);
  else if (table === 'lectures' || table === 'tests' || table === 'labs') course = await moduleCourse(row.moduleId);
  const institutionId = course ? (course as { institutionId: string }).institutionId : ((row.institutionId as string | null) ?? null);
  return { institutionId, authorId: course ? (course as { authorId: string }).authorId : null };
};

const titleOf = (table: TrashTable, row: Record<string, unknown>) => {
  if (table === 'users') return fullName(row as unknown as User);
  return String(row.title ?? row.name ?? row.id);
};

const canRestore = (u: User, info: { institutionId: string | null; authorId: string | null }) =>
  u.role === 'owner' || (u.role === 'director' && info.institutionId === u.institutionId) || (u.role === 'teacher' && info.authorId === u.id);

export const listTrash = async (ctx: Ctx) => {
  const u = needRole(ctx, 'owner', 'director', 'teacher');
  const users = new Map((await ctx.repo.all('users')).map((x) => [x.id, x]));
  const out = [];
  for (const table of TRASH_TABLES) {
    for (const row of (await ctx.repo.all(table)) as unknown as (Base & Record<string, unknown>)[]) {
      if (!row.deletedAt) continue;
      const info = await ownerInfo(ctx, table, row);
      if (!canRestore(u, info)) continue;
      const by = row.deletedBy ? users.get(row.deletedBy) : undefined;
      out.push({
        table,
        kind: TRASH_LABEL[table],
        id: row.id,
        title: titleOf(table, row),
        deletedAt: row.deletedAt,
        deletedByName: by ? fullName(by) : '',
        expiresAt: new Date(new Date(row.deletedAt).getTime() + TRASH_DAYS * DAY).toISOString(),
      });
    }
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
};

export const restoreTrash = async (ctx: Ctx, table: string, id: string) => {
  const u = needRole(ctx, 'owner', 'director', 'teacher');
  const t = oneOf(table, 'Раздел корзины', TRASH_TABLES);
  const row = (await ctx.repo.get(t, id)) as (Base & Record<string, unknown>) | undefined;
  if (!row || !row.deletedAt) throw notFound('Объект в корзине');
  const info = await ownerInfo(ctx, t, row);
  if (!canRestore(u, info)) throw forbidden();
  if (t === 'users' && u.role !== 'owner') {
    const target = row as unknown as User;
    if (target.role === 'director' || target.role === 'owner') throw forbidden('Восстановить директора может владелец платформы');
  }
  await ctx.repo.tx(async () => {
    await ctx.repo.update(t, id, { deletedAt: null, deletedBy: null, ...touch(ctx) } as never);
    /* вместе с разделом возвращаем модули, удалённые вместе с ним */
    if (t === 'sections') {
      const at = new Date(row.deletedAt!).getTime();
      for (const m of await ctx.repo.find('modules', { sectionId: id })) {
        if (m.deletedAt && Math.abs(new Date(m.deletedAt).getTime() - at) < 10_000) {
          await ctx.repo.update('modules', m.id, { deletedAt: null, deletedBy: null, ...touch(ctx) });
        }
      }
    }
    await audit(ctx, 'restore', t, id, `${TRASH_LABEL[t]} «${titleOf(t, row)}» восстановлен(а) из корзины`, info.institutionId);
  });
  return { ok: true };
};

/* окончательное удаление вместе с зависимыми записями — одинаково для браузерной и серверной базы */
const purgeDeep = async (ports: Ports, table: TrashTable, id: string): Promise<void> => {
  const r = ports.repo;
  const dropFile = async (fid: string) => {
    if (!(await r.get('files', fid))) return;
    await ports.files.remove(fid).catch(() => undefined);
    await r.remove('files', fid);
  };
  const dropSubmissions = async (where: { labId?: string; studentId?: string }) => {
    for (const s of await r.find('submissions', where)) {
      for (const fid of s.fileIds) await dropFile(fid);
      await r.remove('submissions', s.id);
    }
  };
  const dropItem = async (kind: 'lectures' | 'tests' | 'labs', itemId: string) => {
    if (kind === 'lectures') for (const v of await r.find('lectureViews', { lectureId: itemId })) await r.remove('lectureViews', v.id);
    if (kind === 'tests') for (const a of await r.find('attempts', { testId: itemId })) await r.remove('attempts', a.id);
    if (kind === 'labs') await dropSubmissions({ labId: itemId });
    await r.remove(kind, itemId);
  };
  const dropModule = async (mid: string) => {
    for (const k of ['lectures', 'tests', 'labs'] as const) for (const it of await r.find(k, { moduleId: mid })) await dropItem(k, it.id);
    await r.remove('modules', mid);
  };
  const dropSection = async (sid: string) => {
    for (const m of await r.find('modules', { sectionId: sid })) await dropModule(m.id);
    await r.remove('sections', sid);
  };
  const dropAssignment = async (aid: string) => {
    for (const s of await r.find('submissions', { assignmentId: aid })) await r.update('submissions', s.id, { assignmentId: null });
    await r.remove('assignments', aid);
  };

  switch (table) {
    case 'lectures':
    case 'tests':
    case 'labs':
      return dropItem(table, id);
    case 'modules':
      return dropModule(id);
    case 'sections':
      return dropSection(id);
    case 'assignments':
      return dropAssignment(id);
    case 'courses':
      for (const a of await r.find('assignments', { courseId: id })) await dropAssignment(a.id);
      for (const sec of await r.find('sections', { courseId: id })) await dropSection(sec.id);
      for (const m of await r.find('modules', { courseId: id })) await dropModule(m.id);
      return r.remove('courses', id);
    case 'groups':
      for (const m of await r.find('groupMembers', { groupId: id })) await r.remove('groupMembers', m.id);
      for (const a of await r.find('assignments', { groupId: id })) await dropAssignment(a.id);
      return r.remove('groups', id);
    case 'departments':
      for (const g of await r.find('groups', { departmentId: id })) await r.update('groups', g.id, { departmentId: null });
      return r.remove('departments', id);
    case 'disciplines':
      if ((await r.find('courses', { disciplineId: id })).length) throw bad('Нельзя стереть дисциплину, пока есть её курсы (в том числе в корзине)');
      return r.remove('disciplines', id);
    case 'users': {
      if ((await r.find('courses', { authorId: id })).length) throw bad('Нельзя стереть пользователя: это автор курсов. Сначала сотрите курсы или передайте их другому преподавателю');
      if ((await r.find('assignments', { teacherId: id })).length) throw bad('Нельзя стереть пользователя: за ним закреплены группы на курсах');
      const owned = await r.find('files', { ownerId: id });
      if (owned.some((f) => f.scope === 'content')) throw bad('Нельзя стереть пользователя: им загружены материалы курсов');
      for (const t of ['sessions', 'notifications', 'lectureViews'] as const) for (const x of await r.find(t, { userId: id })) await r.remove(t, x.id);
      for (const m of await r.find('groupMembers', { studentId: id })) await r.remove('groupMembers', m.id);
      for (const a of await r.find('attempts', { studentId: id })) await r.remove('attempts', a.id);
      await dropSubmissions({ studentId: id });
      for (const f of owned) await dropFile(f.id);
      for (const g of await r.find('groups', { curatorId: id })) await r.update('groups', g.id, { curatorId: null });
      for (const sub of await r.find('submissions', { gradedBy: id })) await r.update('submissions', sub.id, { gradedBy: null });
      return r.remove('users', id);
    }
  }
};

export const purgeTrash = async (ctx: Ctx, table: string, id: string) => {
  const u = needRole(ctx, 'owner', 'director');
  const t = oneOf(table, 'Раздел корзины', TRASH_TABLES);
  const row = (await ctx.repo.get(t, id)) as (Base & Record<string, unknown>) | undefined;
  if (!row || !row.deletedAt) throw notFound('Объект в корзине');
  const info = await ownerInfo(ctx, t, row);
  if (!canRestore(u, info)) throw forbidden();
  await ctx.repo.tx(() => purgeDeep(ctx, t, id));
  await audit(ctx, 'purge', t, id, `${TRASH_LABEL[t]} «${titleOf(t, row)}» удалён(а) окончательно`, info.institutionId);
  return { ok: true };
};

/* очистка по расписанию: корзина старше 30 дней и истёкшие сессии */
export const purgeExpired = async (ports: Ports) => {
  const limit = ports.now().getTime() - TRASH_DAYS * DAY;
  let n = 0;
  for (const table of TRASH_TABLES) {
    for (const row of (await ports.repo.all(table)) as unknown as Base[]) {
      if (!row.deletedAt || new Date(row.deletedAt).getTime() >= limit) continue;
      /* то, что стереть нельзя (автор курсов и т. п.), остаётся в корзине */
      const done = await ports.repo
        .tx(() => purgeDeep(ports, table, row.id))
        .then(() => true)
        .catch(() => false);
      if (done) n++;
    }
  }
  for (const s of await ports.repo.all('sessions')) if (new Date(s.expiresAt).getTime() < ports.now().getTime()) await ports.repo.remove('sessions', s.id);
  return n;
};

/* обновление данных при запуске: старые угадываемые коды групп заменяются случайными;
   у демонстрационных попыток появляются ответы по заданиям (для анализа заданий теста) */
export const upgradeData = async (ports: Ports) => {
  for (const g of await ports.repo.all('groups')) {
    if (!strongCode(g.joinCode)) await ports.repo.update('groups', g.id, { joinCode: joinCode() });
  }
  await fillDemoAnswers(ports);
};

/* ---------- сводка на главной ---------- */
export const dashboard = async (ctx: Ctx) => {
  const u = needUser(ctx);
  if (u.role === 'student') {
    const views = await myCourseViews(ctx);
    const now = ctx.now().toISOString();
    const todo = [];
    const waiting = [];
    const grades = [];
    const tests = [];
    const total = { lectures: 0, lecturesDone: 0, tests: 0, testsDone: 0, labs: 0, labsDone: 0 };
    for (const v of views) {
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += v.progress[k];
      for (const s of v.sections) {
        for (const m of s.modules) {
          if (m.locked) continue;
          for (const l of m.labs) {
            const item = { kind: 'lab' as const, id: l.id, title: l.title, course: v.title, module: m.title, due: l.due, status: l.status };
            if (l.status === null || l.status === 'returned') todo.push({ ...item, overdue: !!l.due && l.due < now });
            if (l.status === 'submitted') waiting.push(item);
            if (l.grade) grades.push({ id: l.id, title: l.title, course: v.title, grade: l.grade });
          }
          for (const t of m.tests) {
            if (t.best !== null) tests.push({ id: t.id, title: t.title, course: v.title, best: t.best, passed: t.passed });
            if (!t.passed && (t.limit === 0 || t.attempts < t.limit)) {
              todo.push({ kind: 'test' as const, id: t.id, title: t.title, course: v.title, module: m.title, due: t.due, status: null, overdue: !!t.due && t.due < now });
            }
          }
        }
      }
    }
    /* сначала просроченные, затем по сроку, без срока — в конце */
    todo.sort((x, y) => (x.due ?? '9999').localeCompare(y.due ?? '9999'));
    const courses = views.map((v) => ({ id: v.id, title: v.title, progress: v.progress, next: nextStep(v), nextDue: v.nextDue, steps: stepsOf(v) }));
    const avg = grades.length ? Math.round((grades.reduce((x, g) => x + g.grade, 0) / grades.length) * 10) / 10 : null;
    return { role: u.role, courses, todo: todo.slice(0, 8), waiting, grades: grades.reverse(), tests, total, average: avg };
  }
  const inInst = <T extends { institutionId: string | null }>(rows: T[]) =>
    u.role === 'owner' ? rows : rows.filter((r) => r.institutionId === u.institutionId);
  const users = inInst(alive(await ctx.repo.all('users')));
  const courses = inInst(alive(await ctx.repo.all('courses')));
  const byRole = Object.fromEntries(Object.keys(ROLE_LABEL).map((r) => [r, users.filter((x) => x.role === r).length]));
  const byStatus = Object.fromEntries(['draft', 'review', 'published', 'archived'].map((s) => [s, courses.filter((c) => c.status === s).length]));
  const pending = isStaff(u) ? (await listSubmissions(ctx, { status: 'submitted' })) : [];
  const base0 = {
    role: u.role,
    users: byRole,
    groups: inInst(alive(await ctx.repo.all('groups'))).length,
    courses: byStatus,
    pending: pending.length,
    pendingList: pending.slice(0, 6),
  };
  if (u.role === 'owner') return { ...base0, institutions: alive(await ctx.repo.all('institutions')).length };
  if (u.role === 'teacher') {
    const mine = courses.filter((c) => c.authorId === u.id);
    return { ...base0, myCourses: mine.length, myDrafts: mine.filter((c) => c.status === 'draft').length };
  }
  return { ...base0, review: courses.filter((c) => c.status === 'review').map((c) => ({ id: c.id, title: c.title })) };
};

/* ---------- файлы ---------- */
const MAX_FILE = 20 * 1024 * 1024;
/* svg не принимаем: в нём может быть скрипт */
const EXT = new Set(
  'pdf doc docx odt rtf txt md png jpg jpeg gif webp zip rar 7z drawio xml json csv xls xlsx ppt pptx cpp c h hpp cs py js ts java sql pas dpr html css'.split(' '),
);

export const fileExtOk = (name: string) => EXT.has(name.split('.').pop()?.toLowerCase() ?? '');

export const createFile = async (
  ctx: Ctx,
  meta: { name: unknown; mime: unknown; size: unknown; scope: unknown },
  data: Uint8Array | Blob,
) => {
  const u = needUser(ctx);
  const name = str(meta.name, 'Имя файла', { max: 200 }).replace(/[\\/:*?"<>|]/g, '_');
  if (!fileExtOk(name)) throw bad('Такой тип файла загружать нельзя');
  const size = typeof meta.size === 'number' ? meta.size : 0;
  if (size <= 0) throw bad('Пустой файл');
  if (size > MAX_FILE) throw bad('Файл больше 20 МБ');
  const scope = oneOf(meta.scope ?? 'submission', 'Назначение файла', ['content', 'submission'] as const);
  if (scope === 'content' && !isStaff(u)) throw forbidden();
  const row: FileRow = {
    ...base(ctx),
    ownerId: u.id,
    institutionId: u.institutionId,
    scope,
    name,
    mime: typeof meta.mime === 'string' && meta.mime.length < 120 ? meta.mime : 'application/octet-stream',
    size,
  };
  await ctx.files.put(row.id, data, row.mime);
  await ctx.repo.insert('files', row);
  return row;
};

/* кто может скачать файл: автор, материалы курса — все в учреждении, сдачи — сотрудники */
export const fileAccess = async (ctx: Ctx, id: string) => {
  const u = needUser(ctx);
  const f = await getAlive(ctx, 'files', id, 'Файл');
  if (f.ownerId === u.id || u.role === 'owner') return f;
  if (f.institutionId !== u.institutionId) throw forbidden();
  if (f.scope === 'content' || isStaff(u)) return f;
  throw forbidden();
};

export const removeFile = async (ctx: Ctx, id: string) => {
  const u = needUser(ctx);
  const f = await getAlive(ctx, 'files', id, 'Файл');
  if (f.ownerId !== u.id && u.role !== 'owner' && u.role !== 'director') throw forbidden();
  await ctx.repo.update('files', id, { deletedAt: ctx.now().toISOString(), deletedBy: u.id });
  await ctx.files.remove(id);
  return { ok: true };
};

export type { Table };
