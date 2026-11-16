/* бот Telegram: привязка по коду «/start КОД», команды с кнопками и оформленные уведомления.
   Имя, аватар, описание и меню команд бот выставляет себе сам при запуске */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOT_COMMANDS, BOT_DESCRIPTION, BOT_SHORT, BRAND, botAnswer, botRole, telegramBind, telegramUnbindChat, type Ports } from '@pc/core';

type Chat = { chat: { id: number } };
type Update = {
  update_id: number;
  message?: Chat & { text?: string };
  callback_query?: { id: string; data?: string; message?: Chat };
};
type Button = { text: string; callback_data?: string; url?: string };

const AVATAR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'bot-avatar.jpg');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* текст уведомления → HTML Telegram: **главное** жирным, строки и пункты списка сохраняются */
const html = (s: string) => esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');

/* значок уведомления по его виду */
const ICONS: [RegExp, string][] = [
  [/^Работа проверена/, '✅'],
  [/^Работа возвращена/, '↩️'],
  [/^Срок/, '⏰'],
  [/^Несданные|^Новые долги/, '⚠️'],
  [/^Сдана/, '📥'],
  [/^Новый курс/, '📚'],
  [/^Курс на проверке/, '📝'],
  [/^Курс опубликован/, '📗'],
  [/^Курс возвращён/, '↩️'],
  [/^Опрос/, '🗳'],
];
const icon = (title: string) => ICONS.find(([re]) => re.test(title))?.[1] ?? '🔔';

export const startBot = async (token: string, ports: Ports, publicUrl: string | undefined) => {
  const api = async <T>(method: string, body: unknown = {}): Promise<T> => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) throw new Error(data.description ?? 'Telegram API');
    return data.result;
  };

  const me = await api<{ id: number; username: string; first_name: string }>('getMe');
  const site = publicUrl?.replace(/\/$/, '');
  /* кнопка-ссылка допустима только на внешний адрес: localhost Telegram не принимает */
  const linkOk = !!site && /^https?:\/\//.test(site) && !/\/\/(localhost|127\.|10\.|192\.168\.)/.test(site);

  /* сообщение с разметкой HTML и кнопками; если кнопки не приняты — без них */
  const send = async (chatId: string | number, text: string, buttons: Button[][] = []) => {
    const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    try {
      await api('sendMessage', buttons.length ? { ...body, reply_markup: { inline_keyboard: buttons } } : body);
    } catch {
      await api('sendMessage', body).catch(() => undefined);
    }
  };

  /* оформление бота: меню команд, описание, имя и аватар выставляются сами при запуске */
  await api('setMyCommands', { commands: BOT_COMMANDS }).catch(() => undefined);
  await api('setMyDescription', { description: BOT_DESCRIPTION }).catch(() => undefined);
  await api('setMyShortDescription', { short_description: BOT_SHORT }).catch(() => undefined);
  /* имя меняем, только если оно другое: у Telegram строгий лимит на смену имени */
  if (me.first_name !== BRAND.name) await api('setMyName', { name: BRAND.name }).catch((e: Error) => console.warn('Имя бота:', e.message));
  /* аватар — значок платформы, если у бота ещё нет фотографии (Bot API: setMyProfilePhoto) */
  const photos = await api<{ total_count: number }>('getUserProfilePhotos', { user_id: me.id, limit: 1 }).catch(() => ({ total_count: 1 }));
  if (!photos.total_count && existsSync(AVATAR)) {
    const form = new FormData();
    form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
    form.append('avatar', new Blob([await readFile(AVATAR)], { type: 'image/jpeg' }), 'avatar.jpg');
    await fetch(`https://api.telegram.org/bot${token}/setMyProfilePhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(40_000) })
      .then((r) => r.json() as Promise<{ ok: boolean; description?: string }>)
      .then((d) => !d.ok && console.warn('Аватар бота:', d.description))
      .catch(() => undefined);
  }

  const siteRow: Button[][] = linkOk ? [[{ text: '🌐 Открыть «Школу модулей»', url: `${site}/` }]] : [];
  const menu = (role: 'student' | 'staff' | null): Button[][] =>
    role === 'student'
      ? [[{ text: '📋 Что сделать', callback_data: '/tasks' }, { text: '📊 Отметки', callback_data: '/grades' }], ...siteRow]
      : role === 'staff'
        ? [[{ text: '📥 На проверке', callback_data: '/tasks' }, { text: '👥 Группа', callback_data: '/group' }], ...siteRow]
        : siteRow;
  const howTo = `Это бот платформы «${BRAND.name}».\n\nЧтобы пользоваться ботом, откройте на сайте <b>«Профиль и настройки» → «Уведомления в Telegram»</b> и нажмите <b>«Подключить»</b>.`;

  /* ответ на команду или на нажатие кнопки */
  const reply = async (chat: string, cmd: string) => {
    const role = await botRole(ports, chat);
    const text = await botAnswer(ports, chat, cmd);
    await send(chat, text ?? howTo, menu(role));
  };

  const handle = async (u: Update) => {
    if (u.callback_query) {
      const q = u.callback_query;
      await api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => undefined);
      if (q.message) await reply(String(q.message.chat.id), q.data ?? '/help');
      return;
    }
    const msg = u.message;
    if (!msg?.text) return;
    const chat = String(msg.chat.id);
    const [raw, arg] = msg.text.trim().split(/\s+/, 2);
    const cmd = (raw ?? '').toLowerCase().replace(/@.*$/, '');
    if (cmd === '/start' && arg) {
      const user = await telegramBind(ports, arg, chat);
      if (!user) return send(chat, '❌ <b>Код не подошёл или устарел</b>\nПолучите новый на сайте: «Профиль и настройки» → «Уведомления в Telegram».');
      await send(chat, `✅ <b>Готово, ${esc(user.firstName)}!</b>\nТеперь сюда будут приходить отметки, возвраты на доработку и напоминания о сроках.`);
      return reply(chat, '/help');
    }
    if (cmd === '/stop') {
      const n = await telegramUnbindChat(ports, chat);
      return send(chat, n ? '🔕 <b>Уведомления отключены</b>\nПодключить снова можно в «Профиле» на сайте.' : 'Этот чат не был привязан.');
    }
    if (['/tasks', '/grades', '/group', '/help', '/start'].includes(cmd)) return reply(chat, cmd === '/start' ? '/help' : cmd);
    await send(chat, '🤔 Не знаю такой команды — вот что я умею:');
    return reply(chat, '/help');
  };

  /* длинный опрос: работает без внешнего адреса и сертификата */
  let offset = 0;
  const loop = async () => {
    for (;;) {
      try {
        const updates = await api<Update[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          await handle(u).catch(() => undefined);
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  void loop();

  /* уведомление пользователю, если чат привязан: значок и заголовок, текст строками,
     под ним — кнопки бота по роли (работают и без внешнего адреса сайта) и «Открыть на сайте», если сайт доступен извне */
  const notify = async (userId: string, data: { title?: string; text?: string; link?: string }) => {
    const u = await ports.repo.get('users', userId);
    if (!u?.telegramChatId || u.deletedAt || u.status !== 'active') return;
    const title = data.title ?? 'Уведомление';
    const role = u.role === 'student' ? 'student' : 'staff';
    const open: Button[][] = linkOk && data.link ? [[{ text: '➡️ Открыть на сайте', url: `${site}/#${data.link}` }]] : [];
    const buttons = [...menu(role).filter((row) => row.every((b) => b.callback_data)), ...open];
    const body = data.text ? `\n\n${html(data.text)}` : '';
    await send(u.telegramChatId, `${icon(title)} <b>${esc(title)}</b>${body}`, buttons);
  };

  return { name: me.username, notify };
};
