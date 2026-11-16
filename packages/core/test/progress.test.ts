/* тесты успеваемости: доступ по ролям, разная успеваемость групп, напоминания, ответы бота */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { test } from 'node:test';
import { AppError, DEMO_PASSWORD, MemoryRepo, botAnswer, dispatch, remindDeadlines, seedDemo, type Method, type Ports } from '../src/index.ts';

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

const makePorts = (): Ports => ({
  repo: new MemoryRepo(),
  hasher,
  files: { async put() {}, async remove() {} },
  events: { publish() {} },
  now: () => new Date(),
  id: () => randomUUID(),
});

const as = async (ports: Ports, login: string) => {
  const r = (await dispatch(ports, 'POST', '/auth/login', { query: {}, body: { login, password: DEMO_PASSWORD }, token: null })) as { token: string };
  return (method: Method, path: string, body?: unknown) => dispatch(ports, method, path, { query: {}, body, token: r.token }) as Promise<any>;
};

test('успеваемость: директор видит три группы с разной успеваемостью, куратор — свою', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const director = await as(ports, 'director');
  const groups = await director('GET', '/progress');
  assert.deepEqual(groups.map((g: { name: string }) => g.name).sort(), ['ПО-31', 'ПО-32', 'ПО-33']);
  const by = Object.fromEntries(groups.map((g: { name: string }) => [g.name, g]));
  assert.ok(by['ПО-31'].students >= 8 && by['ПО-32'].students >= 8, 'в группах есть учащиеся');
  assert.ok(by['ПО-31'].progress > by['ПО-32'].progress, 'сильная группа прошла курс дальше');
  assert.ok(by['ПО-32'].debts > by['ПО-31'].debts, 'у слабой группы больше долгов');

  const teacher = await as(ports, 'teacher');
  const mine = await teacher('GET', '/progress');
  const names = mine.map((g: { name: string }) => g.name);
  assert.ok(names.includes('ПО-31') && !names.includes('ПО-32'), 'преподаватель видит свою группу, но не чужую');
  assert.equal(mine[0].name, 'ПО-31', 'группа куратора — первой');
  assert.equal(mine[0].curated, true);
  const pg = await teacher('GET', `/progress/${by['ПО-31'].id}`);
  assert.equal(pg.students.length, by['ПО-31'].students);
  assert.ok(pg.students.every((s: { progress: number }) => s.progress >= 0 && s.progress <= 100));
  await assert.rejects(teacher('GET', `/progress/${by['ПО-32'].id}`), (e: unknown) => e instanceof AppError && e.status === 403);

  const student = await as(ports, 'student');
  await assert.rejects(student('GET', '/progress'), (e: unknown) => e instanceof AppError && e.status === 403);
});

test('напомнить должникам: уведомление каждому должнику; напоминания о сроках не повторяются', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const director = await as(ports, 'director');
  const g = (await director('GET', '/progress')).find((x: { name: string }) => x.name === 'ПО-32');
  const r = await director('POST', `/progress/${g.id}/remind`);
  assert.equal(r.sent, g.debtors);
  const first = await remindDeadlines(ports);
  const second = await remindDeadlines(ports);
  assert.ok(first >= 0);
  assert.equal(second, 0, 'повторный запуск ничего не отправляет');
});

test('бот: команды отвечают привязанному чату, чужой чат не получает данных', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const [stu] = await ports.repo.find('users', { login: 'student' });
  const [cur] = await ports.repo.find('users', { login: 'teacher' });
  await ports.repo.update('users', stu!.id, { telegramChatId: '1001' });
  await ports.repo.update('users', cur!.id, { telegramChatId: '1002' });
  assert.equal(await botAnswer(ports, '999', '/tasks'), null);
  assert.match((await botAnswer(ports, '1001', '/tasks'))!, /Что сделать|выполнены/);
  assert.match((await botAnswer(ports, '1001', '/help'))!, /\/grades/);
  assert.match((await botAnswer(ports, '1002', '/group'))!, /ПО-31/);
  assert.match((await botAnswer(ports, '1002', '/tasks'))!, /на проверк/i);
});

test('не пускать дальше: проваленный тест закрывает следующие модули, пересдача открывает', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const student = await as(ports, 'student');
  const [course] = await student('GET', '/learn/courses');
  const mods = (v: any) => v.sections.flatMap((s: any) => s.modules);
  const view = await student('GET', `/learn/courses/${course.id}`);
  const all = mods(view);
  /* тест, который учащийся ещё не проходил: самопроверка с неограниченными попытками */
  const fresh = (x: any) => x.gate && x.limit === 0 && x.best === null;
  const k = all.findIndex((m: any) => m.tests.some(fresh));
  assert.ok(k >= 0 && k < all.length - 1, 'есть модуль с тестом самопроверки и модуль после него');
  const t = all[k].tests.find(fresh);
  const later = all.slice(k + 1).find((m: any) => m.lectures.length);
  assert.ok(later, 'после модуля с тестом есть модуль с лекцией');
  const [me] = await ports.repo.find('users', { login: 'student' });
  const attempt = (percent: number) => ({ id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, deletedBy: null, testId: t.id, studentId: me!.id, answers: {}, score: 0, maxScore: 5, percent, details: [] });
  await ports.repo.insert('attempts', attempt(20));
  const locked = mods(await student('GET', `/learn/courses/${course.id}`));
  assert.ok(locked[k + 1].locked, 'следующий модуль закрыт');
  assert.equal(locked[k].locked, null, 'модуль с тестом открыт — тест можно пересдать');
  await assert.rejects(student('GET', `/learn/lectures/${later.lectures[0].id}`), (e: unknown) => e instanceof AppError && e.status === 403 && e.message.includes(t.title));
  await ports.repo.insert('attempts', attempt(100));
  const open = mods(await student('GET', `/learn/courses/${course.id}`));
  assert.ok(open.every((m: any) => !m.locked), 'после пересдачи всё открыто');
  assert.equal((await student('GET', `/learn/lectures/${later.lectures[0].id}`)).id, later.lectures[0].id);
});
