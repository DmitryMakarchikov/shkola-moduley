/* уведомления в Telegram: привязка чата одноразовым кодом */
import { code, iso, needUser, type Ctx } from '../context.ts';
import { bad } from '../errors.ts';
import type { User } from '../model.ts';
import type { Ports } from '../ports.ts';
import { listSubmissions } from './learn.ts';
import { dashboard } from './misc.ts';
import { groupProgress, progressFor } from './progress.ts';

const CODE_TTL = 15 * 60_000;

export const telegramStatus = async (ctx: Ctx) => {
  const u = needUser(ctx);
  return { available: !!ctx.bot, botName: ctx.bot?.name ?? null, linked: !!u.telegramChatId };
};

export const telegramLink = async (ctx: Ctx) => {
  const u = needUser(ctx);
  if (!ctx.bot) throw bad('Бот Telegram не подключён на сервере');
  const c = code(8);
  await ctx.repo.update('users', u.id, { telegramCode: c, telegramCodeExpires: new Date(ctx.now().getTime() + CODE_TTL).toISOString() });
  return { code: c, url: `https://t.me/${ctx.bot.name}?start=${c}`, minutes: CODE_TTL / 60_000 };
};

export const telegramUnlink = async (ctx: Ctx) => {
  const u = needUser(ctx);
  await ctx.repo.update('users', u.id, { telegramChatId: null, telegramCode: null, telegramCodeExpires: null, updatedAt: iso(ctx) });
  return { ok: true };
};

/* вызывает сервер, когда в бот пришло «/start КОД» */
export const telegramBind = async (ports: Ports, raw: string, chatId: string): Promise<User | null> => {
  const c = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(c)) return null;
  const [u] = await ports.repo.find('users', { telegramCode: c });
  if (!u || u.deletedAt || !u.telegramCodeExpires || u.telegramCodeExpires < ports.now().toISOString()) return null;
  /* один чат — одна учётная запись */
  for (const other of await ports.repo.find('users', { telegramChatId: chatId })) {
    if (other.id !== u.id) await ports.repo.update('users', other.id, { telegramChatId: null });
  }
  return ports.repo.update('users', u.id, { telegramChatId: chatId, telegramCode: null, telegramCodeExpires: null });
};

export const telegramUnbindChat = async (ports: Ports, chatId: string) => {
  const rows = await ports.repo.find('users', { telegramChatId: chatId });
  for (const u of rows) await ports.repo.update('users', u.id, { telegramChatId: null });
  return rows.length;
};

/* меню команд бота (показывается в Telegram рядом с полем ввода) */
export const BOT_COMMANDS = [
  { command: 'tasks', description: '📋 Что сделать: сроки, долги, работы на проверке' },
  { command: 'grades', description: '📊 Мои отметки и результаты тестов' },
  { command: 'group', description: '👥 Успеваемость группы — куратору и директору' },
  { command: 'help', description: '💡 Что умеет бот' },
  { command: 'stop', description: '🔕 Отключить уведомления' },
];

/* описание бота: видно до первого сообщения и в профиле */
export const BOT_DESCRIPTION =
  '«Школа модулей» — учебная платформа: лекции по шагам, тесты, лабораторные работы и конструктор UML-диаграмм.\n\n' +
  'Бот присылает отметки, возвраты на доработку и напоминания о сроках, а куратору — сводку успеваемости группы.\n\n' +
  'Подключение: на сайте «Профиль и настройки» → «Уведомления в Telegram» → «Подключить».';
export const BOT_SHORT = 'Отметки, сроки сдачи и успеваемость группы из «Школы модулей».';

/* кто пишет боту: учащийся или сотрудник (для кнопок меню); null — чат не привязан */
export const botRole = async (ports: Ports, chatId: string) => {
  const [u] = await ports.repo.find('users', { telegramChatId: chatId });
  if (!u || u.deletedAt || u.status !== 'active') return null;
  return u.role === 'student' ? ('student' as const) : ('staff' as const);
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dm = (iso: string | null | undefined) => {
  if (!iso) return 'без срока';
  const d = new Date(iso);
  return `до ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const num = (x: number | null) => (x === null ? '—' : String(x).replace('.', ','));
const mark = (g: number) => (g >= 9 ? '🟢' : g >= 7 ? '🔵' : g >= 5 ? '🟡' : '🔴');

/* ответ на команду бота (разметка HTML Telegram); null — чат не привязан к учётной записи */
export const botAnswer = async (ports: Ports, chatId: string, cmd: string): Promise<string | null> => {
  const [u] = await ports.repo.find('users', { telegramChatId: chatId });
  if (!u || u.deletedAt || u.status !== 'active') return null;
  const ctx: Ctx = { ...ports, user: u, ip: 'telegram' };
  const staff = u.role !== 'student';
  if (cmd === '/tasks') {
    if (!staff) {
      const d = (await dashboard(ctx)) as { todo: { title: string; course: string; due: string | null; overdue: boolean }[]; waiting: unknown[] };
      const wait = d.waiting.length ? `\n\n🕓 На проверке у преподавателя: <b>${d.waiting.length}</b>` : '';
      if (!d.todo.length) return `🎉 <b>Все задания выполнены!</b>${wait}`;
      const lines = d.todo.map((t) => `${t.overdue ? '🔴' : '🟡'} <b>${esc(t.title)}</b>\n      ${t.overdue ? 'срок прошёл — сдайте как можно скорее' : dm(t.due)}`);
      return `📋 <b>Что сделать</b>\n\n${lines.join('\n')}${wait}`;
    }
    const subs = await listSubmissions(ctx, { status: 'submitted' });
    if (!subs.length) return '✅ <b>Новых работ на проверку нет</b>';
    const lines = subs.slice(0, 8).map((s) => `• <b>${esc(s.studentName)}</b> — ${esc(s.labTitle)}${s.late ? ' ⏰' : ''}`);
    return `📥 <b>Работ на проверке: ${subs.length}</b>\n\n${lines.join('\n')}${subs.length > 8 ? `\n…и ещё ${subs.length - 8}` : ''}${subs.some((s) => s.late) ? '\n\n⏰ — сдана после срока' : ''}`;
  }
  if (cmd === '/grades') {
    if (staff) return 'Эта команда — для учащихся.\nСводка по группе — /group, работы на проверке — /tasks.';
    const d = (await dashboard(ctx)) as { grades: { title: string; grade: number }[]; tests: { title: string; best: number; passed: boolean }[]; average: number | null };
    if (!d.grades.length && !d.tests.length) return '📊 <b>Отметок пока нет</b>\nОни появятся, когда преподаватель проверит работу или вы пройдёте тест.';
    const g = d.grades.slice(0, 6).map((x) => `${mark(x.grade)} ${esc(x.title)} — <b>${x.grade}</b>`);
    const t = d.tests.slice(0, 6).map((x) => `${x.passed ? '✅' : '❌'} ${esc(x.title)} — <b>${x.best}%</b>`);
    return [`📊 <b>Мои отметки</b>\nСредняя за лабораторные: <b>${num(d.average)}</b>`, g.length ? `\n\n🧪 <b>Лабораторные</b>\n${g.join('\n')}` : '', t.length ? `\n\n📝 <b>Тесты</b>\n${t.join('\n')}` : ''].join('');
  }
  if (cmd === '/group') {
    if (!staff) return 'Эта команда — для кураторов и администрации.';
    const groups = await progressFor(ctx);
    if (!groups.length) return u.role === 'teacher' ? 'Вы не куратор ни одной группы.' : 'Групп пока нет.';
    const parts = [];
    for (const g of groups.slice(0, 5)) {
      const detail = await groupProgress(ctx, g.id);
      const risk = detail.students.filter((s) => s.level === 'risk').slice(0, 4).map((s) => `   • ${esc(s.name)} — ${esc(s.reasons.join(', '))}`);
      parts.push(
        `👥 <b>${esc(g.name)}</b>${g.curated ? ' · ваша группа' : ''}\n` +
          `✅ Выполнено в срок: <b>${g.plan}%</b>\n⭐ Средний балл: <b>${num(g.average)}</b>\n📝 Тесты: <b>${g.testsAverage === null ? '—' : `${Math.round(g.testsAverage)}%`}</b>\n` +
          `⚠️ Долгов: <b>${g.debts}</b> у ${g.debtors} из ${g.students}\n🕓 На проверке: <b>${g.pending}</b>${risk.length ? `\n🔴 <b>В зоне риска</b>\n${risk.join('\n')}` : ''}`,
      );
    }
    return parts.join('\n\n');
  }
  const list = staff ? ['📥 /tasks — работы на проверке', '👥 /group — успеваемость группы'] : ['📋 /tasks — что сделать и сроки', '📊 /grades — мои отметки'];
  return `👋 <b>${esc(u.firstName)}</b>, я бот «Школы модулей».\n\n${list.join('\n')}\n🔕 /stop — отключить уведомления\n\nОтметки, возвраты на доработку и напоминания о сроках я пришлю сам.`;
};
