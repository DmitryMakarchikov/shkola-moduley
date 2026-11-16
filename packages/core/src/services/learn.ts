/* назначения курсов, обучение, сдача и проверка работ, журнал успеваемости */
import { alive, audit, base, getAlive, iso, needRole, needUser, notify, softDelete, touch, type Ctx } from '../context.ts';
import { bad, conflict, forbidden, notFound } from '../errors.ts';
import { checkDiagram, parseDiagram, type Diagram } from '../diagram.ts';
import { correctFor, gradeTest, studentView, variantOf as testVariant } from '../grading.ts';
import { fullName, type Assignment, type Course, type Lab, type Lecture, type Submission, type Test, type User } from '../model.ts';
import { canViewCourseAsStaff, isStaff } from '../roles.ts';
import { arr, idOf, int, obj, str } from '../validate.ts';

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/* ---------- назначения ---------- */
const dueDatesOf = (v: unknown) => {
  const out: Record<string, string> = {};
  if (!v) return out;
  for (const [k, d] of Object.entries(obj(v, 'Сроки'))) {
    if (typeof d !== 'string' || !d) continue;
    const t = new Date(d);
    if (Number.isNaN(t.getTime())) throw bad('Неверная дата срока сдачи');
    out[k.slice(0, 64)] = t.toISOString();
  }
  return out;
};

export const listAssignments = async (ctx: Ctx, query: Record<string, string | undefined> = {}) => {
  const u = needRole(ctx, 'owner', 'director', 'methodist', 'teacher');
  const courses = new Map(alive(await ctx.repo.all('courses')).map((c) => [c.id, c]));
  const groups = new Map(alive(await ctx.repo.all('groups')).map((g) => [g.id, g]));
  const users = new Map((await ctx.repo.all('users')).map((x) => [x.id, x]));
  return alive(await ctx.repo.all('assignments'))
    .filter((a) => {
      const c = courses.get(a.courseId);
      if (!c || !canViewCourseAsStaff(u, c)) return false;
      if (query.courseId && a.courseId !== query.courseId) return false;
      if (query.groupId && a.groupId !== query.groupId) return false;
      return true;
    })
    .map((a) => ({
      ...a,
      courseTitle: courses.get(a.courseId)?.title ?? '',
      groupName: groups.get(a.groupId)?.name ?? '',
      teacherName: users.get(a.teacherId) ? fullName(users.get(a.teacherId)!) : '',
    }));
};

export const createAssignment = async (ctx: Ctx, input: unknown) => {
  const u = needRole(ctx, 'owner', 'director', 'teacher');
  const b = obj(input);
  const course = await getAlive(ctx, 'courses', idOf(b.courseId, 'Курс'), 'Курс');
  const group = await getAlive(ctx, 'groups', idOf(b.groupId, 'Группа'), 'Группа');
  if (!canViewCourseAsStaff(u, course) || group.institutionId !== course.institutionId) throw forbidden();
  if (course.status !== 'published') throw bad('Назначить группе можно только опубликованный курс');
  if (alive(await ctx.repo.find('assignments', { courseId: course.id, groupId: group.id })).length) {
    throw conflict('Этот курс уже назначен группе');
  }
  const row: Assignment = { ...base(ctx), courseId: course.id, groupId: group.id, teacherId: u.id, dueDates: dueDatesOf(b.dueDates) };
  await ctx.repo.insert('assignments', row);
  await audit(ctx, 'create', 'assignments', row.id, `Курс «${course.title}» назначен группе ${group.name}`, course.institutionId);
  const students = alive(await ctx.repo.find('groupMembers', { groupId: group.id })).map((m) => m.studentId);
  await notify(ctx, students, 'Новый курс', `Группе ${group.name} назначен курс **«${course.title}»**.\nОн уже в разделе «Мои курсы».`, `/learn/${course.id}`);
  return row;
};

export const updateAssignment = async (ctx: Ctx, id: string, input: unknown) => {
  const u = needRole(ctx, 'owner', 'director', 'teacher');
  const a = await getAlive(ctx, 'assignments', id, 'Назначение');
  const course = await getAlive(ctx, 'courses', a.courseId, 'Курс');
  if (u.role === 'teacher' && a.teacherId !== u.id) throw forbidden();
  if (!canViewCourseAsStaff(u, course)) throw forbidden();
  return ctx.repo.update('assignments', id, { dueDates: dueDatesOf(obj(input).dueDates), ...touch(ctx) });
};

export const removeAssignment = async (ctx: Ctx, id: string) => {
  const u = needRole(ctx, 'owner', 'director', 'teacher');
  const a = await getAlive(ctx, 'assignments', id, 'Назначение');
  if (u.role === 'teacher' && a.teacherId !== u.id) throw forbidden();
  const course = await getAlive(ctx, 'courses', a.courseId, 'Курс');
  if (!canViewCourseAsStaff(u, course)) throw forbidden();
  await softDelete(ctx, 'assignments', id);
  await audit(ctx, 'delete', 'assignments', id, `Снято назначение курса «${course.title}»`, course.institutionId);
  return { ok: true };
};

/* ---------- доступ учащегося ---------- */
const studentGroupIds = async (ctx: Ctx, studentId: string) =>
  new Set(alive(await ctx.repo.find('groupMembers', { studentId })).map((m) => m.groupId));

const assignmentsFor = async (ctx: Ctx, student: User, courseId?: string) => {
  const groups = await studentGroupIds(ctx, student.id);
  return alive(await ctx.repo.all('assignments')).filter((a) => groups.has(a.groupId) && (!courseId || a.courseId === courseId));
};

/* учащийся видит только опубликованный курс, назначенный его группе; сотрудник — как просмотр */
const learnAccess = async (ctx: Ctx, course: Course) => {
  const u = needUser(ctx);
  if (isStaff(u)) {
    if (!canViewCourseAsStaff(u, course)) throw forbidden();
    return { user: u, assignment: null as Assignment | null, preview: true };
  }
  if (course.status !== 'published') throw forbidden('Курс недоступен');
  const [assignment] = await assignmentsFor(ctx, u, course.id);
  if (!assignment) throw forbidden('Этот курс не назначен вашей группе');
  return { user: u, assignment, preview: false };
};

const courseOfItem = async (ctx: Ctx, moduleId: string) => {
  const m = await getAlive(ctx, 'modules', moduleId, 'Модуль');
  const c = await getAlive(ctx, 'courses', m.courseId, 'Курс');
  return { m, c };
};

const latest = (subs: Submission[]) => subs.sort((a, b) => b.version - a.version)[0];

/* тест не пускает дальше: по настройке, а без неё — тест для самопроверки, но не контрольная */
const gates = (t: Test) => t.settings.gate ?? t.settings.mode !== 'control';

/* тяжёлые поля, которые не нужны для списков и сводок */
const LECTURE_HEAVY: (keyof Lecture)[] = ['blocks'];
const TEST_HEAVY: (keyof Test)[] = ['questions'];
const LAB_HEAVY: (keyof Lab)[] = ['blocks', 'description', 'variants', 'criteria', 'diagramReference', 'controlQuestions', 'templateFileIds'];

/* строки по модулям в порядке позиций */
const byModule = <R extends { moduleId: string; position: number }>(rows: R[]) => {
  const map = new Map<string, R[]>();
  for (const r of rows.sort(byPos)) {
    const list = map.get(r.moduleId);
    if (list) list.push(r);
    else map.set(r.moduleId, [r]);
  }
  return map;
};

/* ---------- учащийся ---------- */
/* курсы учащегося: полное представление каждого назначенного курса */
export const myCourseViews = async (ctx: Ctx) => {
  const u = needRole(ctx, 'student');
  const out = [];
  const seen = new Set<string>();
  for (const a of await assignmentsFor(ctx, u)) {
    if (seen.has(a.courseId)) continue;
    seen.add(a.courseId);
    const c = await ctx.repo.get('courses', a.courseId);
    if (!c || c.deletedAt || c.status !== 'published') continue;
    out.push(await learnCourse(ctx, c.id));
  }
  return out;
};

type CourseView = Awaited<ReturnType<typeof learnCourse>>;

/* следующий шаг: первая непрочитанная лекция, несданный тест или несданная работа */
export const nextStep = (v: CourseView) => {
  for (const s of v.sections) {
    for (const m of s.modules) {
      if (m.locked) return { kind: 'test' as const, id: m.locked.testId, title: m.locked.title, module: m.locked.module };
      const l = m.lectures.find((x) => !x.viewed);
      if (l) return { kind: 'lecture' as const, id: l.id, title: l.title, module: m.title };
      const t = m.tests.find((x) => !x.passed && (x.limit === 0 || x.attempts < x.limit));
      if (t) return { kind: 'test' as const, id: t.id, title: t.title, module: m.title };
      const b = m.labs.find((x) => x.status === null || x.status === 'returned');
      if (b) return { kind: 'lab' as const, id: b.id, title: b.title, module: m.title };
    }
  }
  return null;
};

/* ступени курса: по модулю — выполнено из всего */
/* ступени прогресса: по модулям, а в длинном курсе — по разделам (40 ступеней шириной в пиксель ничего не показывают) */
export const stepsOf = (v: CourseView) => {
  type M = CourseView['sections'][number]['modules'][number];
  const count = (m: M) => ({
    done: m.lectures.filter((l) => l.viewed).length + m.tests.filter((t) => t.passed).length + m.labs.filter((l) => l.status === 'graded').length,
    total: m.lectures.length + m.tests.length + m.labs.length,
  });
  const modules = v.sections.flatMap((s) => s.modules.map((m) => ({ title: m.title, ...count(m) })));
  if (modules.length <= 12) return modules;
  return v.sections
    .filter((s) => s.modules.length)
    .map((s) => {
      const parts = s.modules.map(count);
      return { title: s.title, done: parts.reduce((x, p) => x + p.done, 0), total: parts.reduce((x, p) => x + p.total, 0) };
    });
};

export const myCourses = async (ctx: Ctx) =>
  (await myCourseViews(ctx)).map((v) => ({ id: v.id, title: v.title, description: v.description, progress: v.progress, nextDue: v.nextDue, next: nextStep(v), steps: stepsOf(v) }));

export const learnCourse = async (ctx: Ctx, courseId: string) => {
  const course = await getAlive(ctx, 'courses', courseId, 'Курс');
  const { user, assignment, preview } = await learnAccess(ctx, course);
  const sections = alive(await ctx.repo.find('sections', { courseId })).sort(byPos);
  const modules = alive(await ctx.repo.find('modules', { courseId })).sort(byPos);
  const views = new Set((await ctx.repo.find('lectureViews', { userId: user.id })).map((v) => v.lectureId));
  /* содержимое курса — тремя запросами на весь курс и без тяжёлых полей */
  const ids = modules.map((m) => m.id);
  const lecturesBy = byModule(alive(await ctx.repo.list('lectures', 'moduleId', ids, LECTURE_HEAVY)));
  const testsBy = byModule(alive(await ctx.repo.list('tests', 'moduleId', ids, TEST_HEAVY)));
  const labsBy = byModule(alive(await ctx.repo.list('labs', 'moduleId', ids, LAB_HEAVY)));
  const myAttempts = await ctx.repo.find('attempts', { studentId: user.id });
  const mySubs = await ctx.repo.find('submissions', { studentId: user.id });
  const due = assignment?.dueDates ?? {};
  const total = { lectures: 0, lecturesDone: 0, tests: 0, testsDone: 0, labs: 0, labsDone: 0 };
  let nextDue: { title: string; due: string } | null = null;
  const now = ctx.now().toISOString();
  const tree = [];
  /* «не пускать дальше»: тест сдан хуже проходного и есть пересдача — следующие модули закрыты, пока его не пересдать */
  let block: { testId: string; title: string; pass: number; module: string } | null = null;
  for (const s of sections) {
    const mods = [];
    for (const m of modules.filter((x) => x.sectionId === s.id)) {
      const locked = !preview && block ? { ...block } : null;
      const lectures = (lecturesBy.get(m.id) ?? []).map((l) => {
        total.lectures++;
        if (views.has(l.id)) total.lecturesDone++;
        return { id: l.id, title: l.title, viewed: views.has(l.id) };
      });
      const tests = [];
      /* черновики тестов учащиеся не видят */
      for (const t of (testsBy.get(m.id) ?? []).filter((x) => preview || !x.settings.draft)) {
        const attempts = myAttempts.filter((a) => a.testId === t.id);
        const best = attempts.reduce((mx, a) => Math.max(mx, a.percent), -1);
        const passed = best >= t.settings.passPercent;
        total.tests++;
        if (passed) total.testsDone++;
        tests.push({ id: t.id, title: t.title, best: best < 0 ? null : best, passed, attempts: attempts.length, limit: t.settings.attempts, due: due[t.id] ?? null, pass: t.settings.passPercent, gate: gates(t) });
      }
      const labs = [];
      for (const l of labsBy.get(m.id) ?? []) {
        const last = latest(mySubs.filter((s) => s.labId === l.id));
        total.labs++;
        if (last?.status === 'graded') total.labsDone++;
        const d = due[l.id] ?? null;
        if (d && d > now && last?.status !== 'graded' && (!nextDue || d < nextDue.due)) nextDue = { title: l.title, due: d };
        labs.push({ id: l.id, title: l.title, status: last?.status ?? null, grade: last?.grade ?? null, due: d });
      }
      mods.push({ id: m.id, title: m.title, position: m.position, goal: m.goal, tasks: m.tasks, outcomes: m.outcomes, hours: m.hours, lectures, tests, labs, locked });
      if (!preview && !block) {
        const bad = tests.find((t) => t.gate && t.attempts > 0 && !t.passed && (t.limit === 0 || t.attempts < t.limit));
        if (bad) block = { testId: bad.id, title: bad.title, pass: bad.pass, module: m.title };
      }
    }
    tree.push({ id: s.id, title: s.title, modules: mods });
  }
  const parts = total.lectures + total.tests + total.labs;
  const done = total.lecturesDone + total.testsDone + total.labsDone;
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    preview,
    sections: tree,
    progress: { ...total, percent: parts ? Math.round((done / parts) * 100) : 0 },
    nextDue,
  };
};

/* модуль закрыт замком «не пускать дальше» — объясняем, что сдать */
const ensureOpen = async (ctx: Ctx, courseId: string, moduleId: string, preview: boolean) => {
  if (preview) return;
  const v = await learnCourse(ctx, courseId);
  const m = v.sections.flatMap((s) => s.modules).find((x) => x.id === moduleId);
  if (m?.locked) throw forbidden(`Модуль откроется, когда тест «${m.locked.title}» будет сдан не ниже чем на ${m.locked.pass} %`);
};

export const learnLecture = async (ctx: Ctx, id: string) => {
  const lecture = await getAlive(ctx, 'lectures', id, 'Лекция');
  const { m, c } = await courseOfItem(ctx, lecture.moduleId);
  const { user, preview } = await learnAccess(ctx, c);
  await ensureOpen(ctx, c.id, m.id, preview);
  const viewed = (await ctx.repo.find('lectureViews', { lectureId: id, userId: user.id })).length > 0;
  return { ...lecture, viewed, module: { id: m.id, title: m.title, goal: m.goal }, course: { id: c.id, title: c.title } };
};

export const markViewed = async (ctx: Ctx, id: string) => {
  const lecture = await getAlive(ctx, 'lectures', id, 'Лекция');
  const { c } = await courseOfItem(ctx, lecture.moduleId);
  const { user } = await learnAccess(ctx, c);
  if (!(await ctx.repo.find('lectureViews', { lectureId: id, userId: user.id })).length) {
    await ctx.repo.insert('lectureViews', { ...base(ctx), lectureId: id, userId: user.id });
  }
  return { ok: true };
};

/* зерно варианта: учащийся, тест, номер попытки */
const attemptSeed = (userId: string, testId: string, attemptNo: number) => `${userId}:${testId}:${attemptNo}`;

export const learnTest = async (ctx: Ctx, id: string) => {
  const test = await getAlive(ctx, 'tests', id, 'Тест');
  const { m, c } = await courseOfItem(ctx, test.moduleId);
  const { user, assignment, preview } = await learnAccess(ctx, c);
  if (test.settings.draft && !preview) throw notFound('Тест');
  await ensureOpen(ctx, c.id, m.id, preview);
  const attempts = (await ctx.repo.find('attempts', { testId: id, studentId: user.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    ...studentView(test, attemptSeed(user.id, id, attempts.length)),
    /* номер попытки определяет вариант; размер банка показывает, что набор индивидуальный */
    attemptNo: attempts.length,
    bank: test.questions.length,
    module: { id: m.id, title: m.title },
    course: { id: c.id, title: c.title },
    due: assignment?.dueDates[id] ?? null,
    attempts: attempts.map((a) => ({ id: a.id, percent: a.percent, score: a.score, maxScore: a.maxScore, createdAt: a.createdAt })),
  };
};

export const submitAttempt = async (ctx: Ctx, id: string, input: unknown) => {
  const test = await getAlive(ctx, 'tests', id, 'Тест');
  const { m, c } = await courseOfItem(ctx, test.moduleId);
  const { user, preview } = await learnAccess(ctx, c);
  await ensureOpen(ctx, c.id, m.id, preview);
  if (test.settings.draft && !preview) throw notFound('Тест');
  const body = obj(input);
  const answers = obj(body.answers ?? {}, 'Ответы');
  if (JSON.stringify(answers).length > 50_000) throw bad('Слишком большой ответ');
  const previous = await ctx.repo.find('attempts', { testId: id, studentId: user.id });
  if (!preview && test.settings.attempts > 0 && previous.length >= test.settings.attempts) {
    throw bad('Попытки закончились');
  }
  /* проверяется тот вариант, который был выдан на эту попытку */
  if (!preview && typeof body.attemptNo === 'number' && body.attemptNo !== previous.length) {
    throw conflict('Эта попытка уже отправлена. Откройте тест заново');
  }
  const seed = attemptSeed(user.id, id, previous.length);
  const result = gradeTest(test, answers, seed);
  if (!preview) {
    await ctx.repo.insert('attempts', { ...base(ctx), testId: id, studentId: user.id, answers, ...result });
  }
  const passed = result.percent >= test.settings.passPercent;
  /* в режиме контроля разбор ответов не показываем */
  if (test.settings.mode === 'control' && !preview) return { ...result, passed, details: [], review: [] };
  const v = testVariant(test, seed);
  return {
    ...result,
    passed,
    review: v.questions.map((q) => ({
      id: q.id,
      correct: result.details.find((d) => d.id === q.id)?.correct ?? false,
      answer: correctFor(q, v),
      explain: q.explain,
    })),
  };
};

/* вариант по номеру в списке группы (по алфавиту) — выдаётся автоматически */
const variantOf = async (ctx: Ctx, user: User, lab: Lab): Promise<number | null> => {
  if (!lab.variants.length) return null;
  const member = alive(await ctx.repo.find('groupMembers', { studentId: user.id }))[0];
  if (!member) return null;
  const names = [];
  for (const m of alive(await ctx.repo.find('groupMembers', { groupId: member.groupId }))) {
    const st = await ctx.repo.get('users', m.studentId);
    if (st && !st.deletedAt) names.push({ id: st.id, name: fullName(st) });
  }
  names.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const pos = names.findIndex((x) => x.id === user.id);
  return pos < 0 ? null : pos % lab.variants.length;
};

/* эталон для варианта учащегося */
const referenceFor = (lab: Lab, variant: number | null): Diagram | null => {
  if (!lab.diagramKind || !lab.diagramReference) return null;
  const ref = lab.diagramReference as Diagram | (Diagram | null)[];
  if (Array.isArray(ref)) return ref[variant ?? 0] ?? null;
  return ref;
};

/* проверка диаграммы до сдачи: ошибки нотации и совпадение с эталоном без раскрытия ответа */
export const checkLabDiagram = async (ctx: Ctx, id: string, input: unknown) => {
  const lab = await getAlive(ctx, 'labs', id, 'Лабораторная работа');
  const { c } = await courseOfItem(ctx, lab.moduleId);
  const { user, preview } = await learnAccess(ctx, c);
  if (!lab.diagramKind) throw bad('В этой работе нет диаграммы');
  const d = parseDiagram(obj(input).diagram, lab.diagramKind);
  const variant = preview ? 0 : await variantOf(ctx, user, lab);
  return checkDiagram(d, referenceFor(lab, variant));
};

/* лабораторная для учащегося: эталонная диаграмма скрыта */
export const learnLab = async (ctx: Ctx, id: string) => {
  const lab = await getAlive(ctx, 'labs', id, 'Лабораторная работа');
  const { m, c } = await courseOfItem(ctx, lab.moduleId);
  const { user, assignment, preview } = await learnAccess(ctx, c);
  await ensureOpen(ctx, c.id, m.id, preview);
  const subs = (await ctx.repo.find('submissions', { labId: id, studentId: user.id })).sort((a, b) => b.version - a.version);
  const files = new Map((await ctx.repo.all('files')).map((f) => [f.id, f]));
  const fileInfo = (ids: string[]) => ids.map((fid) => files.get(fid)).filter(Boolean).map((f) => ({ id: f!.id, name: f!.name, size: f!.size, mime: f!.mime }));
  const { diagramReference: _ref, ...rest } = lab;
  const myVariant = preview ? null : await variantOf(ctx, user, lab);
  return {
    ...rest,
    myVariant,
    hasReference: lab.diagramReference !== null,
    templates: fileInfo(lab.templateFileIds),
    module: { id: m.id, title: m.title },
    course: { id: c.id, title: c.title },
    due: assignment?.dueDates[id] ?? null,
    preview,
    submissions: subs.map((s) => ({ ...s, files: fileInfo(s.fileIds) })),
  };
};

export const submitLab = async (ctx: Ctx, id: string, input: unknown) => {
  const lab = await getAlive(ctx, 'labs', id, 'Лабораторная работа');
  const { m, c } = await courseOfItem(ctx, lab.moduleId);
  const { user, assignment, preview } = await learnAccess(ctx, c);
  await ensureOpen(ctx, c.id, m.id, preview);
  if (preview) throw bad('Сотрудник не сдаёт лабораторные работы — это режим просмотра');
  const b = obj(input);
  const fileIds = arr(b.fileIds, 'Файлы', (x) => idOf(x, 'Файл'), 10);
  for (const fid of fileIds) {
    const f = await getAlive(ctx, 'files', fid, 'Файл');
    if (f.ownerId !== user.id) throw forbidden('Можно прикреплять только свои файлы');
  }
  if (!lab.allowFiles && fileIds.length) throw bad('В этой работе файлы не прикрепляются');
  const diagram = b.diagram === undefined || b.diagram === null ? null : lab.diagramKind ? parseDiagram(b.diagram, lab.diagramKind) : null;
  const autoScore = diagram ? checkDiagram(diagram, referenceFor(lab, await variantOf(ctx, user, lab))).score : null;
  const comment = str(b.comment, 'Комментарий', { max: 3000, optional: true });
  if (!fileIds.length && !comment && diagram === null) throw bad('Прикрепите файл, диаграмму или напишите комментарий');
  const prev = latest(await ctx.repo.find('submissions', { labId: id, studentId: user.id }));
  if (prev?.status === 'graded') throw bad('Работа уже оценена. Если нужно пересдать, попросите преподавателя вернуть её на доработку');
  const dueDate = assignment?.dueDates[id];
  const row: Submission = {
    ...base(ctx),
    labId: id,
    studentId: user.id,
    assignmentId: assignment?.id ?? null,
    version: (prev?.version ?? 0) + 1,
    fileIds,
    comment,
    diagram,
    autoScore,
    status: 'submitted',
    grade: null,
    teacherComment: '',
    gradedBy: null,
    gradedAt: null,
    late: !!dueDate && iso(ctx) > dueDate,
  };
  await ctx.repo.insert('submissions', row);
  await audit(ctx, 'create', 'submissions', row.id, `${fullName(user)} сдал(а) «${lab.title}», версия ${row.version}`, c.institutionId);
  await notify(
    ctx,
    [assignment?.teacherId ?? c.authorId],
    'Сдана лабораторная работа',
    `**${fullName(user)}**\n«${lab.title}»${row.version > 1 ? `\nВерсия ${row.version} — после доработки` : ''}${row.late ? '\nСдана после срока' : ''}`,
    `/review/${row.id}`,
  );
  return row;
};

/* ---------- преподаватель: проверка работ ---------- */
const staffCourseIds = async (ctx: Ctx, u: User) => {
  const courses = alive(await ctx.repo.all('courses')).filter((c) => canViewCourseAsStaff(u, c));
  if (u.role !== 'teacher') return new Set(courses.map((c) => c.id));
  const assigned = new Set(alive(await ctx.repo.all('assignments')).filter((a) => a.teacherId === u.id).map((a) => a.courseId));
  return new Set(courses.filter((c) => c.authorId === u.id || assigned.has(c.id)).map((c) => c.id));
};

export const listSubmissions = async (ctx: Ctx, query: Record<string, string | undefined> = {}) => {
  const u = needRole(ctx, 'owner', 'director', 'methodist', 'teacher');
  const courseIds = await staffCourseIds(ctx, u);
  const modules = new Map(alive(await ctx.repo.all('modules')).map((m) => [m.id, m]));
  const labs = new Map(alive(await ctx.repo.list('labs', 'moduleId', [...modules.keys()], LAB_HEAVY)).map((l) => [l.id, l]));
  const courses = new Map(alive(await ctx.repo.all('courses')).map((c) => [c.id, c]));
  const users = new Map((await ctx.repo.all('users')).map((x) => [x.id, x]));
  const members = alive(await ctx.repo.all('groupMembers'));
  const groups = new Map(alive(await ctx.repo.all('groups')).map((g) => [g.id, g]));
  /* диаграммы в очереди не нужны */
  const all = await ctx.repo.list('submissions', 'labId', [...labs.keys()], ['diagram']);
  /* в очереди — последняя версия каждой работы */
  const last = new Map<string, Submission>();
  for (const s of all) {
    const key = `${s.labId}/${s.studentId}`;
    const cur = last.get(key);
    if (!cur || s.version > cur.version) last.set(key, s);
  }
  const rows = [];
  for (const s of last.values()) {
    const lab = labs.get(s.labId);
    const mod = lab ? modules.get(lab.moduleId) : undefined;
    const course = mod ? courses.get(mod.courseId) : undefined;
    if (!lab || !mod || !course || !courseIds.has(course.id)) continue;
    if (query.status && s.status !== query.status) continue;
    if (query.courseId && course.id !== query.courseId) continue;
    const student = users.get(s.studentId);
    const groupIds = members.filter((m) => m.studentId === s.studentId).map((m) => m.groupId);
    if (query.groupId && !groupIds.includes(query.groupId)) continue;
    rows.push({
      id: s.id,
      version: s.version,
      status: s.status,
      grade: s.grade,
      late: s.late,
      createdAt: s.createdAt,
      studentName: student ? fullName(student) : '',
      groupName: groupIds.map((g) => groups.get(g)?.name).filter(Boolean).join(', '),
      labTitle: lab.title,
      moduleTitle: mod.title,
      courseTitle: course.title,
    });
  }
  return rows.sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'submitted' ? -1 : 1));
};

const submissionAccess = async (ctx: Ctx, id: string) => {
  const u = needRole(ctx, 'owner', 'director', 'methodist', 'teacher');
  const s = await getAlive(ctx, 'submissions', id, 'Сдача');
  const lab = await getAlive(ctx, 'labs', s.labId, 'Лабораторная работа');
  const { m, c } = await courseOfItem(ctx, lab.moduleId);
  if (!(await staffCourseIds(ctx, u)).has(c.id)) throw forbidden();
  return { u, s, lab, m, c };
};

export const getSubmission = async (ctx: Ctx, id: string) => {
  const { s, lab, m, c } = await submissionAccess(ctx, id);
  const student = await ctx.repo.get('users', s.studentId);
  const files = new Map((await ctx.repo.all('files')).map((f) => [f.id, f]));
  const versions = (await ctx.repo.find('submissions', { labId: s.labId, studentId: s.studentId })).sort((a, b) => b.version - a.version);
  const groupIds = alive(await ctx.repo.find('groupMembers', { studentId: s.studentId })).map((m) => m.groupId);
  const groupNames = [];
  for (const gid of groupIds) {
    const g = await ctx.repo.get('groups', gid);
    if (g && !g.deletedAt) groupNames.push(g.name);
  }
  return {
    ...s,
    studentName: student ? fullName(student) : '',
    groupName: groupNames.join(', '),
    lab: { id: lab.id, title: lab.title, goal: lab.goal, criteria: lab.criteria, maxScore: lab.maxScore, diagramKind: lab.diagramKind, diagramReference: lab.diagramReference },
    module: { id: m.id, title: m.title },
    course: { id: c.id, title: c.title },
    versions: versions.map((v) => ({
      ...v,
      files: v.fileIds.map((f) => files.get(f)).filter(Boolean).map((f) => ({ id: f!.id, name: f!.name, size: f!.size, mime: f!.mime })),
    })),
  };
};

export const gradeSubmission = async (ctx: Ctx, id: string, input: unknown) => {
  const { u, s, lab, c } = await submissionAccess(ctx, id);
  if (u.role !== 'teacher' && u.role !== 'director' && u.role !== 'owner') throw forbidden('Ставит отметку преподаватель');
  const b = obj(input);
  const grade = int(b.grade, 'Отметка', 1, lab.maxScore);
  const row = await ctx.repo.update('submissions', id, {
    status: 'graded',
    grade,
    teacherComment: str(b.comment, 'Замечание', { max: 3000, optional: true }),
    gradedBy: u.id,
    gradedAt: iso(ctx),
    ...touch(ctx),
  });
  await audit(ctx, 'grade', 'submissions', id, `«${lab.title}»: отметка ${grade}`, c.institutionId);
  await notify(ctx, [s.studentId], 'Работа проверена', `«${lab.title}»\nОтметка: **${grade}** из ${lab.maxScore}${row.teacherComment ? `\nКомментарий: ${row.teacherComment}` : ''}`, `/learn/lab/${lab.id}`);
  return row;
};

export const returnSubmission = async (ctx: Ctx, id: string, input: unknown) => {
  const { u, s, lab, c } = await submissionAccess(ctx, id);
  if (u.role === 'methodist') throw forbidden();
  const comment = str(obj(input).comment, 'Что исправить', { max: 3000 });
  const row = await ctx.repo.update('submissions', id, { status: 'returned', teacherComment: comment, gradedBy: u.id, gradedAt: iso(ctx), ...touch(ctx) });
  await audit(ctx, 'return', 'submissions', id, `«${lab.title}» возвращена на доработку`, c.institutionId);
  await notify(ctx, [s.studentId], 'Работа возвращена на доработку', `«${lab.title}»\nЧто исправить: **${comment}**`, `/learn/lab/${lab.id}`);
  return row;
};

/* ---------- журнал успеваемости ---------- */
export const journal = async (ctx: Ctx, query: Record<string, string | undefined>) => {
  const u = needRole(ctx, 'owner', 'director', 'methodist', 'teacher');
  const course = await getAlive(ctx, 'courses', idOf(query.courseId, 'Курс'), 'Курс');
  const group = await getAlive(ctx, 'groups', idOf(query.groupId, 'Группа'), 'Группа');
  if (!(await staffCourseIds(ctx, u)).has(course.id) || group.institutionId !== course.institutionId) throw forbidden();
  const students = [];
  for (const m of alive(await ctx.repo.find('groupMembers', { groupId: group.id }))) {
    const s = await ctx.repo.get('users', m.studentId);
    if (s && !s.deletedAt) students.push(s);
  }
  students.sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'));
  const modules = alive(await ctx.repo.find('modules', { courseId: course.id })).sort(byPos);
  const columns: { type: 'test' | 'lab'; id: string; title: string; module: string }[] = [];
  const ids = modules.map((m) => m.id);
  const testsBy = byModule(alive(await ctx.repo.list('tests', 'moduleId', ids, TEST_HEAVY)));
  const labsBy = byModule(alive(await ctx.repo.list('labs', 'moduleId', ids, LAB_HEAVY)));
  for (const m of modules) {
    for (const t of (testsBy.get(m.id) ?? []).filter((x) => !x.settings.draft)) columns.push({ type: 'test', id: t.id, title: t.title, module: m.title });
    for (const l of labsBy.get(m.id) ?? []) columns.push({ type: 'lab', id: l.id, title: l.title, module: m.title });
  }
  const attempts = await ctx.repo.list('attempts', 'testId', columns.filter((c) => c.type === 'test').map((c) => c.id), ['answers', 'details']);
  const subs = await ctx.repo.list('submissions', 'labId', columns.filter((c) => c.type === 'lab').map((c) => c.id), ['diagram']);
  const rows = students.map((s) => {
    const cells: Record<string, { percent?: number | null; grade?: number | null; status?: string | null; late?: boolean }> = {};
    const grades: number[] = [];
    for (const col of columns) {
      if (col.type === 'test') {
        const mine = attempts.filter((a) => a.testId === col.id && a.studentId === s.id);
        cells[col.id] = { percent: mine.length ? Math.max(...mine.map((a) => a.percent)) : null };
      } else {
        const last = latest(subs.filter((x) => x.labId === col.id && x.studentId === s.id));
        cells[col.id] = { grade: last?.grade ?? null, status: last?.status ?? null, late: last?.late ?? false };
        if (last?.grade) grades.push(last.grade);
      }
    }
    const average = grades.length ? Math.round((grades.reduce((x, y) => x + y, 0) / grades.length) * 10) / 10 : null;
    return { id: s.id, name: fullName(s), cells, average };
  });
  return { course: { id: course.id, title: course.title }, group: { id: group.id, name: group.name }, columns, rows };
};
