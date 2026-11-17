/* тесты поиска, словаря курса, анализа заданий и опроса на занятии */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { test } from 'node:test';
import { AppError, DEMO_PASSWORD, MemoryRepo, dispatch, fillDemoAnswers, findRanges, fold, gradeTest, queryWords, seedDemo, upgradeData, type Method, type Ports } from '../src/index.ts';

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

test('интерактивные схемы: точки проверяются, добавляются из пакета курса один раз, лента схем курса', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const teacher = await as(ports, 'teacher');
  const student = await as(ports, 'student');
  const [course] = await student('GET', '/learn/courses');
  const view = await student('GET', `/learn/courses/${course.id}`);
  const lid = view.sections.flatMap((s: any) => s.modules).flatMap((m: any) => m.lectures)[0].id;
  const SRC = 'course/trpo/x-1.webp';
  const lec = (await ports.repo.get('lectures', lid))!;
  await ports.repo.update('lectures', lid, { blocks: [...lec.blocks, { type: 'image', fileId: '', src: SRC, caption: 'Рис. 1. Схема' }] });
  const map = { [SRC]: [{ x: 10, y: 20, title: 'Блок', text: 'Пояснение из лекции' }] };
  await upgradeData(ports, { figurePoints: map });
  const last = async () => (await ports.repo.get('lectures', lid))!.blocks.at(-1) as any;
  assert.equal((await last()).points.length, 1, 'точки добавлены из пакета курса');
  await upgradeData(ports, { figurePoints: map });
  assert.equal((await last()).points.length, 1, 'повторно не добавляются');
  const f = await student('GET', `/learn/courses/${course.id}/figures`);
  assert.equal(f.figures.length, 1);
  assert.equal(f.figures[0].points, 1);
  assert.equal(f.figures[0].lectureId, lid);
  /* преподаватель удалил все точки — при обновлении данных они не возвращаются */
  const blocks = (await ports.repo.get('lectures', lid))!.blocks.map((b: any) => (b.src === SRC ? { ...b, points: [] } : b));
  await teacher('PATCH', `/lectures/${lid}`, { title: lec.title, blocks });
  await upgradeData(ports, { figurePoints: map });
  assert.equal((await last()).points.length, 0);
  /* координаты ограничиваются рамками рисунка, неверные отклоняются */
  const withPoints = (pts: unknown) => (ports.repo.get('lectures', lid) as Promise<any>).then((l) => teacher('PATCH', `/lectures/${lid}`, { title: l.title, blocks: l.blocks.map((b: any) => (b.src === SRC ? { ...b, points: pts } : b)) }));
  await withPoints([{ x: 150, y: -5, title: 'Край', text: '' }]);
  assert.deepEqual([(await last()).points[0].x, (await last()).points[0].y], [100, 0]);
  await assert.rejects(withPoints([{ x: 'левее', y: 5, title: '', text: '' }]), (e: unknown) => e instanceof AppError && e.status === 400);
});

test('вопросы по ходу чтения: задания самопроверки без ответов, проверка одного задания без попытки; контрольный тест и тест с ограничением попыток не проверяются', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const student = await as(ports, 'student');
  const [course] = await student('GET', '/learn/courses');
  const view = await student('GET', `/learn/courses/${course.id}`);
  const mod = view.sections.flatMap((s: any) => s.modules).find((m: any) => !m.locked && m.lectures.length && m.tests.length);
  const r = await student('GET', `/learn/lectures/${mod.lectures[0].id}/questions`);
  assert.ok(r.testId, 'найден тест для самопроверки');
  assert.ok(r.questions.length >= 1 && r.questions.length <= 8);
  assert.ok(r.questions.every((q: any) => (q.type === 'single' || q.type === 'multi') && !('answer' in q) && !('explain' in q)), 'ответы не передаются');
  const t = (await ports.repo.get('tests', r.testId))!;
  const q = t.questions.find((x) => x.id === r.questions[0].id)!;
  const right = q.answer.map(Number);
  const before = (await ports.repo.find('attempts', {})).length;
  const ok = await student('POST', `/learn/tests/${t.id}/check`, { questionId: q.id, answer: q.type === 'single' ? right[0] : right });
  assert.equal(ok.correct, true);
  const wrong = q.options.findIndex((_, i) => !right.includes(i));
  const no = await student('POST', `/learn/tests/${t.id}/check`, { questionId: q.id, answer: q.type === 'single' ? wrong : [wrong] });
  assert.equal(no.correct, false);
  assert.deepEqual(no.answer, right);
  assert.equal((await ports.repo.find('attempts', {})).length, before, 'попытка не создаётся');
  await assert.rejects(student('POST', `/learn/tests/${t.id}/check`, { questionId: q.id, answer: [] }), (e: unknown) => e instanceof AppError && e.status === 400);
  /* контрольный тест и тест с ограничением попыток: вопросы не выдаются, проверка запрещена */
  for (const settings of [{ ...t.settings, mode: 'control' as const }, { ...t.settings, attempts: 2 }]) {
    await ports.repo.update('tests', t.id, { settings });
    await assert.rejects(student('POST', `/learn/tests/${t.id}/check`, { questionId: q.id, answer: right[0] }), (e: unknown) => e instanceof AppError && e.status === 403);
    const again = await student('GET', `/learn/lectures/${mod.lectures[0].id}/questions`);
    assert.notEqual(again.testId, t.id);
  }
});

test('чтение: повторы из импорта убираются с переносом выделения; место задания — номер последнего блока раздела', async () => {
  const { cleanRepeats, lectureParts } = await import('../src/index.ts');
  const s = 'Требование – описание того, какие функции должна выполнять система.';
  assert.equal(cleanRepeats(`${s}${s}**Требование** – описание того, какие функции должна выполнять система.`), '**Требование** – описание того, какие функции должна выполнять система.');
  assert.equal(cleanRepeats('Документ о концепции и границахДокумент о концепции и границахДокумент о концепции и границах'), 'Документ о концепции и границах');
  assert.equal(cleanRepeats('Базовые классыКлассы данныхWeb ServicesWeb FormsБазовые классыКлассы данныхWeb ServicesWeb Forms'), 'Базовые классы · Классы данных · Web Services · Web Forms');
  const plain = 'Обычный абзац. Второе предложение абзаца без повторов.\n\nЕщё абзац.';
  assert.equal(cleanRepeats(plain), plain, 'текст без повторов не меняется');
  const parts = lectureParts([{ type: 'text', text: 'Вводный абзац' }, { type: 'heading', text: 'Раздел' }, { type: 'text', text: 'а' }, { type: 'list', items: ['б'], ordered: false }, { type: 'heading', text: 'Пустой' }]);
  assert.deepEqual(parts.map((p) => [p.title, p.last]), [['Основные понятия', 0], ['Раздел', 3]]);
  /* сервер отдаёт задания с местом: номер блока лекции или null */
  const ports = makePorts();
  await seedDemo(ports);
  const student = await as(ports, 'student');
  const [course] = await student('GET', '/learn/courses');
  const view = await student('GET', `/learn/courses/${course.id}`);
  for (const m of view.sections.flatMap((x: any) => x.modules).filter((x: any) => !x.locked && x.lectures.length)) {
    const lec = await student('GET', `/learn/lectures/${m.lectures[0].id}`);
    const r = await student('GET', `/learn/lectures/${lec.id}/questions`);
    const lasts = new Set(lectureParts(lec.blocks).map((p) => p.last));
    for (const q of r.questions) assert.ok(q.after === null || lasts.has(q.after), 'задание встаёт в конце раздела');
    assert.equal(new Set(r.questions.filter((q: any) => q.after !== null).map((q: any) => q.after)).size, r.questions.filter((q: any) => q.after !== null).length, 'в разделе не больше одного задания');
    assert.equal(typeof lec.module.no, 'number');
  }
});
