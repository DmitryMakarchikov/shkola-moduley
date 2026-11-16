/* тесты ядра: вход, права директора, полный цикл курса, обучение и проверка */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { test } from 'node:test';
import { AppError, DEMO_PASSWORD, MemoryRepo, dispatch, seedDemo, type Method, type Ports } from '../src/index.ts';

const hasher = {
  async hash(p: string) {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('hex')}$${scryptSync(p, salt, 32).toString('hex')}`;
  },
  async verify(p: string, h: string) {
    const [, salt, hex] = h.split('$');
    if (!salt || !hex) return false;
    const a = scryptSync(p, Buffer.from(salt, 'hex'), 32);
    return timingSafeEqual(a, Buffer.from(hex, 'hex'));
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

const api = (ports: Ports) => {
  let token: string | null = null;
  const call = async (method: Method, path: string, body?: unknown, query: Record<string, string> = {}) =>
    dispatch(ports, method, path, { query, body, token }) as Promise<any>;
  return {
    call,
    async login(login: string, password = DEMO_PASSWORD) {
      const r = await call('POST', '/auth/login', { login, password });
      token = r.token;
      return r.user;
    },
  };
};

const fails = async (p: Promise<unknown>, status: number) => {
  await assert.rejects(p, (e: unknown) => e instanceof AppError && e.status === status);
};

test('вход: верный пароль, неверный пароль, блокировка после 5 попыток', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const a = api(ports);
  const u = await a.login('director');
  assert.equal(u.role, 'director');
  assert.equal(u.passwordHash, undefined, 'хеш пароля не уходит в интерфейс');
  const b = api(ports);
  for (let i = 0; i < 5; i++) await fails(b.login('teacher', 'wrong-pass1'), 401);
  await fails(b.login('teacher'), 429);
});

test('директор: удаляет преподавателя, но не себя и не другого директора', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const a = api(ports);
  const me = await a.login('director');
  const users = await a.call('GET', '/users');
  const zam = users.find((x: any) => x.login === 'zamdir');
  const teacher2 = users.find((x: any) => x.login === 'teacher2');
  await fails(a.call('DELETE', `/users/${me.id}`), 403);
  await fails(a.call('DELETE', `/users/${zam.id}`), 403);
  await a.call('DELETE', `/users/${teacher2.id}`);
  const trash = await a.call('GET', '/trash');
  assert.ok(trash.some((t: any) => t.id === teacher2.id), 'удалённый в корзине');
  await a.call('POST', `/trash/users/${teacher2.id}/restore`);
  assert.ok((await a.call('GET', '/users')).some((x: any) => x.id === teacher2.id), 'восстановлен');
  const created = await a.call('POST', '/users', { role: 'teacher', login: 'new.teacher', lastName: 'Новый', firstName: 'Преподаватель' });
  assert.ok(created.tempPassword, 'выдан временный пароль');
  await fails(a.call('POST', '/users', { role: 'director', login: 'dir2', lastName: 'А', firstName: 'Б' }), 403);
});

test('полный цикл: курс → модуль → лекция, тест, лабораторная → утверждение → назначение → сдача → проверка → журнал', async () => {
  const ports = makePorts();
  await seedDemo(ports);
  const teacher = api(ports);
  await teacher.login('teacher');
  const disc = (await teacher.call('GET', '/disciplines'))[0];
  const course = await teacher.call('POST', '/courses', { disciplineId: disc.id, title: 'Тестовый курс' });
  const section = await teacher.call('POST', `/courses/${course.id}/sections`, { title: 'Раздел 1' });
  const mod = await teacher.call('POST', `/sections/${section.id}/modules`, { title: 'Тема 1', outcomes: ['умею строить диаграммы'] });
  await teacher.call('POST', `/modules/${mod.id}/lectures`, { title: 'Лекция', blocks: [{ type: 'text', text: 'Текст лекции' }] });
  const tst = await teacher.call('POST', `/modules/${mod.id}/tests`, {
    title: 'Тест',
    questions: [
      { type: 'single', text: 'Два плюс два?', options: ['3', '4'], answer: [1] },
      { type: 'short', text: 'Столица Беларуси?', answer: ['Минск'] },
    ],
  });
  const lab = await teacher.call('POST', `/modules/${mod.id}/labs`, { title: 'Лабораторная', description: 'Сделать' });
  await fails(teacher.call('POST', `/modules/${mod.id}/tests`, { title: 'Плохой', questions: [{ type: 'single', text: 'x', options: ['a'], answer: [5] }] }), 400);

  await teacher.call('POST', `/courses/${course.id}/status`, { action: 'submit' });
  const metodist = api(ports);
  await metodist.login('metodist');
  await metodist.call('POST', `/courses/${course.id}/status`, { action: 'approve' });

  const group = (await teacher.call('GET', '/groups')).find((g: any) => g.name === 'ПО-31');
  await teacher.call('POST', '/assignments', { courseId: course.id, groupId: group.id });

  const student = api(ports);
  await student.login('student');
  const mine = await student.call('GET', '/learn/courses');
  assert.ok(mine.some((c: any) => c.id === course.id), 'курс виден учащемуся');
  const view = await student.call('GET', `/learn/tests/${tst.id}`);
  assert.equal(view.questions[0].answer, undefined, 'правильные ответы скрыты');
  /* варианты ответа у каждого учащегося перемешаны по-своему: индекс берётся из его представления */
  const q1 = view.questions.find((q: { id: string }) => q.id === 'q1');
  const res = await student.call('POST', `/learn/tests/${tst.id}/attempts`, { attemptNo: view.attemptNo, answers: { q1: q1.options.indexOf('4'), q2: ' минск ' } });
  assert.equal(res.percent, 100);
  const sub = await student.call('POST', `/learn/labs/${lab.id}/submissions`, { comment: 'Готово' });
  const queue = await teacher.call('GET', '/submissions', undefined, { status: 'submitted' });
  assert.ok(queue.some((s: any) => s.id === sub.id), 'работа в очереди проверки');
  await teacher.call('POST', `/submissions/${sub.id}/grade`, { grade: 9, comment: 'Хорошо' });
  const j = await teacher.call('GET', '/journal', undefined, { courseId: course.id, groupId: group.id });
  const row = j.rows.find((r: any) => r.cells[lab.id]?.grade === 9);
  assert.ok(row, 'отметка в журнале');
  await fails(student.call('GET', '/users'), 403);
});
