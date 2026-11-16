/* тесты поиска, словаря курса, анализа заданий и опроса на занятии */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { test } from 'node:test';
import { AppError, DEMO_PASSWORD, MemoryRepo, dispatch, fillDemoAnswers, findRanges, fold, gradeTest, queryWords, seedDemo, type Method, type Ports } from '../src/index.ts';

const hasher = {
  async hash(p: string) {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('hex')}$${scryptSync(p, salt, 32).toString('hex')}`;
  },
  async verify(p: string, h: string) {
    const [, salt, hex] = h.split('$');
    if (!salt || !hex) return false;
    return timingSafeEqual(scryptSync(p, Buffer.from(salt, 'hex'), 32), Buffer.from(hex, 'hex'));
  },
  token: () => randomBytes(32).toString('base64url'),
  async digest(t: string) {
    return createHash('sha256').update(t).digest('hex');
  },
};

const makePorts = (log: { ids: string[]; type: string }[] = []): Ports => ({
  repo: new MemoryRepo(),
  hasher,
  files: { async put() {}, async remove() {} },
  events: { publish: (ids, e) => void log.push({ ids, type: e.type }) },
  now: () => new Date(),
  id: () => randomUUID(),
});

const as = async (ports: Ports, login: string) => {
  const r = (await dispatch(ports, 'POST', '/auth/login', { query: {}, body: { login, password: DEMO_PASSWORD }, token: null })) as { token: string };
  return (method: Method, path: string, body?: unknown, query: Record<string, string> = {}) => dispatch(ports, method, path, { query, body, token: r.token }) as Promise<any>;
};

test('сравнение строк: регистр, «ё» и знак ударения не мешают; подсветка находит позиции в исходном тексте', () => {
  assert.equal(fold('Актёр'), 'актер');
  assert.equal(fold('Структу́рное'), 'структурное');
  assert.deepEqual(queryWords('  Диаграмма, КЛАССОВ  классов '), ['диаграмма', 'классов']);
  const text = 'Структу́рное программирование';
  const [r] = findRanges(text, ['структурное']);
  assert.deepEqual(text.slice(r![0], r![1]), 'Структу́рное');
  /* слово ищется с начала слова: окончания не мешают, совпадение внутри другого слова не считается */
  const t2 = 'Характер связи: роль актёра';
  const found = findRanges(t2, ['актер']);
  assert.equal(found.length, 1);
  assert.equal(t2.slice(found[0]![0], found[0]![1]), 'актёр');
});

test('поиск: учащийся находит термины и лекции своего курса, но не группы и людей; сотрудник — и группы, и учащихся', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const student = await as(ports, 'student');
  const r = await student('GET', '/search', undefined, { q: 'актёр' });
  assert.ok(r.hits.length > 0);
  assert.ok(r.hits.some((h: any) => h.kind === 'term' && h.title === 'Актёр' && h.link.includes('/glossary?t=')));
  assert.ok(r.hits.some((h: any) => h.kind === 'lecture' && h.link.startsWith('/learn/lecture/') && h.link.includes('?q=')));
  assert.ok(r.hits.every((h: any) => h.kind !== 'group' && h.kind !== 'student'), 'учащийся не ищет по людям');
  const short = await student('GET', '/search', undefined, { q: 'а' });
  assert.equal(short.hits.length, 0, 'одна буква — не запрос');

  const teacher = await as(ports, 'teacher');
  const g = await teacher('GET', '/search', undefined, { q: 'ПО-31' });
  assert.ok(g.hits.some((h: any) => h.kind === 'group' && h.title === 'ПО-31'));
  const [stu] = await ports.repo.find('users', { login: 'student' });
  const s = await teacher('GET', '/search', undefined, { q: stu!.lastName });
  assert.ok(s.hits.some((h: any) => h.kind === 'student' && h.title.startsWith(stu!.lastName)));
  const lec = await teacher('GET', '/search', undefined, { q: 'кратность' });
  assert.ok(lec.hits.some((h: any) => h.kind === 'term'));
  assert.ok(lec.hits.every((h: any) => typeof h.snippet === 'string'));
});

test('поиск учащегося не показывает модули, закрытые несданным тестом', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const student = await as(ports, 'student');
  const [course] = await student('GET', '/learn/courses');
  const view = await student('GET', `/learn/courses/${course.id}`);
  const mods = view.sections.flatMap((s: any) => s.modules);
  const k = mods.findIndex((m: any) => m.tests.some((t: any) => t.gate && t.limit === 0 && t.best === null));
  const t = mods[k].tests.find((x: any) => x.gate && x.limit === 0 && x.best === null);
  const later = mods.slice(k + 1).find((m: any) => m.lectures.length);
  const before = await student('GET', '/search', undefined, { q: later.lectures[0].title });
  assert.ok(before.hits.some((h: any) => h.id === later.lectures[0].id), 'до провала лекция находится');
  const [me] = await ports.repo.find('users', { login: 'student' });
  const now = new Date().toISOString();
  await ports.repo.insert('attempts', { id: randomUUID(), createdAt: now, updatedAt: now, deletedAt: null, deletedBy: null, testId: t.id, studentId: me!.id, answers: {}, score: 1, maxScore: 5, percent: 20, details: [] });
  const after = await student('GET', '/search', undefined, { q: later.lectures[0].title });
  assert.ok(!after.hits.some((h: any) => h.id === later.lectures[0].id), 'после провала закрытая лекция не находится');
});

test('словарь курса: термины всех лекций по алфавиту, со ссылкой на лекцию; чужой курс недоступен', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const student = await as(ports, 'student');
  const [course] = await student('GET', '/learn/courses');
  const g = await student('GET', `/learn/courses/${course.id}/glossary`);
  const names = g.terms.map((t: any) => t.term);
  for (const t of ['Актёр', 'Кратность', 'Модель', 'Прецедент']) assert.ok(names.includes(t), t);
  assert.deepEqual(names, [...names].sort((a: string, b: string) => a.localeCompare(b, 'ru')), 'по алфавиту');
  assert.ok(g.terms.every((t: any) => t.defs.length > 0 && t.defs.every((d: any) => d.lectureId && d.moduleNo > 0)));
  assert.ok(g.letters.includes('А') && g.letters.includes('М'));
  /* учащийся без этого курса не открывает словарь */
  const [other] = await ports.repo.find('users', { role: 'student' });
  const outsider = { ...other!, id: randomUUID(), login: 'outsider' };
  await ports.repo.insert('users', { ...outsider, passwordHash: await hasher.hash(DEMO_PASSWORD) });
  const o = await as(ports, 'outsider');
  await assert.rejects(o('GET', `/learn/courses/${course.id}/glossary`), (e: unknown) => e instanceof AppError && e.status === 403);
});

test('анализ заданий: демонстрационные попытки получают ответы, итог «сдан/не сдан» не меняется; сводка и показатели заданий', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const before = new Map((await ports.repo.all('attempts')).map((a) => [a.id, a.percent]));
  const tests = new Map((await ports.repo.all('tests')).map((t) => [t.id, t]));
  const n = await fillDemoAnswers(ports);
  assert.ok(n > 10, `заполнено попыток: ${n}`);
  assert.equal(await fillDemoAnswers(ports), 0, 'повторно ничего не меняется');
  for (const a of await ports.repo.all('attempts')) {
    const t = tests.get(a.testId)!;
    assert.ok(a.details.length > 0);
    const was = before.get(a.id)!;
    assert.equal(a.percent >= t.settings.passPercent, was >= t.settings.passPercent, 'сдан/не сдан сохранён');
    /* ответы согласованы с проверкой */
    const k = (await ports.repo.find('attempts', { testId: a.testId, studentId: a.studentId })).sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id)).findIndex((x) => x.id === a.id);
    assert.equal(gradeTest(t, a.answers, `${a.studentId}:${a.testId}:${k}`).percent, a.percent);
  }
  const director = await as(ports, 'director');
  const counts = new Map<string, number>();
  for (const a of await ports.repo.all('attempts')) counts.set(a.testId, (counts.get(a.testId) ?? 0) + 1);
  const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const s = await director('GET', `/tests/${busiest}/stats`);
  assert.ok(s.summary.students > 0 && s.summary.attempts >= s.summary.students);
  assert.ok(s.summary.avgBest >= s.summary.avgFirst, 'лучшая попытка не хуже первой');
  assert.equal(s.summary.dist.reduce((x: number, y: number) => x + y, 0), s.summary.students);
  assert.ok(s.groups.length >= 2);
  for (const q of s.questions) {
    if (q.p !== null) assert.ok(q.p >= 0 && q.p <= 1);
    if (q.type === 'single' && q.mapped) assert.equal(q.opts.reduce((x: number, y: number) => x + y, 0), q.mapped, 'один выбор на попытку');
  }
  /* преподаватель второй группы видит только свои группы */
  const t2 = await as(ports, 'teacher2');
  const s2 = await t2('GET', `/tests/${busiest}/stats`);
  assert.ok(s2.groups.length >= 1 && s2.groups.length < s.groups.length);
  const student = await as(ports, 'student');
  await assert.rejects(student('GET', `/tests/${busiest}/stats`), (e: unknown) => e instanceof AppError && e.status === 403);
});

test('опрос на занятии: учащиеся группы отвечают, преподаватель видит распределение, разбор после показа ответа', async () => {
  const log: { ids: string[]; type: string }[] = [];
  const ports = makePorts(log);
  await seedDemo(ports);
  const teacher = await as(ports, 'teacher');
  const student = await as(ports, 'student');
  const [course] = await student('GET', '/learn/courses');
  const view = await student('GET', `/learn/courses/${course.id}`);
  const testId = view.sections.flatMap((s: any) => s.modules).flatMap((m: any) => m.tests)[0].id;
  const [me] = await ports.repo.find('users', { login: 'student' });
  const [member] = await ports.repo.find('groupMembers', { studentId: me!.id });
  const { id } = await teacher('POST', '/live', { testId, groupId: member!.groupId });
  assert.ok(log.some((e) => e.type === 'live' && e.ids.includes(me!.id)), 'учащийся получил событие');
  const active = await student('GET', '/live/active');
  assert.equal(active.live.id, id);
  const sv = await student('GET', `/live/${id}`);
  assert.equal(sv.role, 'student');
  assert.equal(sv.question.answer, undefined, 'до показа ответ скрыт');
  await student('POST', `/live/${id}/answer`, { questionId: sv.question.id, answer: [0] });
  const tv = await teacher('GET', `/live/${id}`);
  assert.equal(tv.answered, 1);
  assert.equal(tv.counts[0], 1);
  await assert.rejects(student('POST', `/live/${id}/control`, { action: 'next' }), (e: unknown) => e instanceof AppError && e.status === 403);
  await teacher('POST', `/live/${id}/control`, { action: 'reveal' });
  const revealed = await student('GET', `/live/${id}`);
  assert.ok(Array.isArray(revealed.question.answer));
  assert.equal(typeof revealed.right, 'boolean');
  await assert.rejects(student('POST', `/live/${id}/answer`, { questionId: sv.question.id, answer: [1] }), (e: unknown) => e instanceof AppError && e.status === 400);
  await teacher('POST', `/live/${id}/control`, { action: 'finish' });
  const done = await student('GET', `/live/${id}`);
  assert.equal(done.finished, true);
  assert.ok(done.summary.length >= 1 && done.summary[0].answered === 1);
  assert.equal((await student('GET', '/live/active')).live, null, 'завершённый опрос не активен');
});
