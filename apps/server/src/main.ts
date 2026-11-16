/* сервер платформы «Школа модулей»: API, файлы, события, раздача сайта */
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  AppError,
  createFile,
  dispatch,
  fileAccess,
  purgeExpired,
  remindDeadlines,
  upgradeData,
  resolveSession,
  seedDemo,
  type CoursePackage,
  type Hasher,
  type Method,
  type Ports,
} from '@pc/core';
import { openRepo } from './repo-pg.ts';
import { startBot } from './telegram.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'));
const STORAGE = resolve(process.env.STORAGE_DIR ?? join(ROOT, 'storage'));
const WEB = resolve(process.env.WEB_DIR ?? join(ROOT, '..', 'web', 'dist'));
const SECURE = process.env.COOKIE_SECURE === '1';
const COOKIE = 'pc_session';

/* пароли: scrypt со случайной солью */
const scrypt = promisify(scryptCb) as (p: string, s: Buffer, n: number) => Promise<Buffer>;
const hasher: Hasher = {
  async hash(p) {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('hex')}$${(await scrypt(p, salt, 32)).toString('hex')}`;
  },
  async verify(p, h) {
    const [kind, salt, hex] = h.split('$');
    if (kind !== 'scrypt' || !salt || !hex) return false;
    const a = await scrypt(p, Buffer.from(salt, 'hex'), 32);
    const b = Buffer.from(hex, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  },
  token: () => randomBytes(32).toString('base64url'),
  digest: async (t) => createHash('sha256').update(t).digest('hex'),
};

/* события в реальном времени: уведомления и «живой урок» */
const streams = new Map<string, Set<FastifyReply>>();
let botNotify: ((userId: string, data: { title?: string; text?: string; link?: string }) => Promise<void>) | null = null;
const events = {
  publish(userIds: string[], event: { type: string; data?: unknown }) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const id of userIds) for (const r of streams.get(id) ?? []) r.raw.write(line);
    /* копия уведомления в Telegram */
    if (botNotify && event.type === 'notification') for (const id of userIds) void botNotify(id, (event.data ?? {}) as { title?: string }).catch(() => undefined);
  },
};

const files = {
  async put(id: string, data: Uint8Array | Blob) {
    await mkdir(STORAGE, { recursive: true });
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    await writeFile(join(STORAGE, id), bytes);
  },
  async remove(id: string) {
    await rm(join(STORAGE, id), { force: true });
  },
};

await mkdir(DATA, { recursive: true });
const { repo, kind } = await openRepo({ databaseUrl: process.env.DATABASE_URL, dataDir: join(DATA, 'pglite') });
const ports: Ports = { repo, hasher, files, events, now: () => new Date(), id: () => randomUUID() };

/* курс из материалов преподавателя (packages/course-trpo/course.json), если он есть */
const COURSE = resolve(ROOT, '..', '..', 'packages', 'course-trpo', 'course.json');
const coursePkg = existsSync(COURSE) ? (JSON.parse(await readFile(COURSE, 'utf8')) as CoursePackage) : undefined;
if (process.env.SEED_DEMO !== '0' && (await seedDemo(ports, coursePkg))) console.log('Заполнены демонстрационные данные');
await upgradeData(ports);
await purgeExpired(ports);
setInterval(() => void purgeExpired(ports), 6 * 3_600_000).unref();
/* напоминания о сроках и сводка новых долгов куратору — раз в полчаса (уведомление на сайте и в Telegram) */
const remind = () => void remindDeadlines(ports).catch((e: Error) => console.warn('Напоминания:', e.message));
setTimeout(remind, 60_000).unref();
setInterval(remind, 30 * 60_000).unref();

/* бот Telegram — если задан токен (файл .env: TELEGRAM_BOT_TOKEN=...) */
if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    const bot = await startBot(process.env.TELEGRAM_BOT_TOKEN, ports, process.env.PUBLIC_URL);
    ports.bot = { name: bot.name };
    botNotify = bot.notify;
    console.log(`Бот Telegram подключён: @${bot.name}`);
  } catch (e) {
    console.warn('Бот Telegram не запущен:', (e as Error).message);
  }
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, bodyLimit: 2 * 1024 * 1024, trustProxy: true });

/* JSON: пустое тело считается пустым объектом */
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body as string));
  } catch {
    done(Object.assign(new Error('Некорректный JSON'), { statusCode: 400 }), undefined);
  }
});

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://rutube.ru', 'https://vk.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
});
await app.register(cookie);
/* лимит только для API (статика и картинки лекций не считаются) и по сессии: группа за одним адресом колледжа не делит общий лимит */
await app.register(rateLimit, { global: false, max: 600, timeWindow: '1 minute', keyGenerator: (req) => req.cookies[COOKIE] ?? req.ip });
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

const tokenOf = (req: FastifyRequest) => req.cookies[COOKIE] ?? null;

const setSession = (reply: FastifyReply, token: string) =>
  reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: SECURE, maxAge: 14 * 86_400 });

const sendError = (reply: FastifyReply, e: unknown) => {
  if (e instanceof AppError) return reply.code(e.status).send({ error: e.message, code: e.code });
  app.log.error(e);
  return reply.code(500).send({ error: 'Внутренняя ошибка сервера. Попробуйте ещё раз', code: 'server_error' });
};

const loginHits = new Map<string, number[]>();

app.addHook('onRequest', async (req, reply) => {
  /* CSRF: изменяющие запросы должны нести собственный заголовок — чужой сайт его не отправит */
  if (req.url.startsWith('/api/') && req.method !== 'GET' && req.headers['x-pc-request'] !== '1') {
    return reply.code(403).send({ error: 'Запрос отклонён', code: 'csrf' });
  }
  /* вход: не больше 60 попыток в минуту с одного адреса — хватает группе, которая входит в начале занятия из сети колледжа;
     подбор пароля к одной учётной записи останавливает блокировка после неудачных попыток */
  if (req.method === 'POST' && (req.url === '/api/auth/login' || req.url === '/api/auth/join')) {
    const now = Date.now();
    const hits = (loginHits.get(req.ip) ?? []).filter((t) => now - t < 60_000);
    hits.push(now);
    loginHits.set(req.ip, hits);
    if (hits.length > 60) return reply.code(429).send({ error: 'Слишком много попыток входа. Подождите минуту', code: 'too_many' });
  }
});

app.get('/api/health', async () => ({ ok: true, mode: 'server', db: kind }));

app.post('/api/files', async (req, reply) => {
  try {
    const user = await resolveSession(ports, tokenOf(req));
    if (!user) throw new AppError(401, 'unauthorized', 'Войдите в систему');
    const part = await req.file();
    if (!part) throw new AppError(400, 'bad_request', 'Файл не получен');
    const bytes = await part.toBuffer();
    const scope = (part.fields.scope as { value?: string } | undefined)?.value ?? 'submission';
    const row = await createFile({ ...ports, user, ip: req.ip }, { name: part.filename, mime: part.mimetype, size: bytes.length, scope }, bytes);
    return row;
  } catch (e) {
    return sendError(reply, e);
  }
});

app.get('/api/files/:id', async (req, reply) => {
  try {
    const user = await resolveSession(ports, tokenOf(req));
    if (!user) throw new AppError(401, 'unauthorized', 'Войдите в систему');
    const f = await fileAccess({ ...ports, user, ip: req.ip }, (req.params as { id: string }).id);
    const path = join(STORAGE, f.id);
    if (!existsSync(path)) throw new AppError(404, 'not_found', 'Файл не найден');
    const inline = /^image\/(png|jpe?g|gif|webp)$/.test(f.mime) || f.mime === 'application/pdf';
    reply
      .header('Content-Type', inline ? f.mime : 'application/octet-stream')
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('Content-Security-Policy', 'sandbox')
      .header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(path));
  } catch (e) {
    return sendError(reply, e);
  }
});

app.get('/api/events', async (req, reply) => {
  const user = await resolveSession(ports, tokenOf(req));
  if (!user) return reply.code(401).send({ error: 'Войдите в систему' });
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  reply.raw.write('data: {"type":"hello"}\n\n');
  const set = streams.get(user.id) ?? new Set();
  set.add(reply);
  streams.set(user.id, set);
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
  req.raw.on('close', () => {
    clearInterval(ping);
    set.delete(reply);
  });
  return reply;
});

/* весь остальной API — общая таблица маршрутов ядра */
app.route({
  method: ['GET', 'POST', 'PATCH', 'DELETE'],
  url: '/api/*',
  config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  handler: async (req, reply) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/^\/api/, '');
    const query = Object.fromEntries(url.searchParams);
    try {
      const result = (await dispatch(ports, req.method as Method, path, { query, body: req.body ?? null, token: tokenOf(req) }, req.ip)) as Record<string, unknown>;
      if ((path === '/auth/login' || path === '/auth/join') && typeof result?.token === 'string') {
        setSession(reply, result.token);
        return { user: result.user };
      }
      if (path === '/auth/logout') reply.clearCookie(COOKIE, { path: '/' });
      return result ?? { ok: true };
    } catch (e) {
      return sendError(reply, e);
    }
  },
});

if (existsSync(WEB)) {
  /* preCompressed: браузер получает заранее сжатые копии (.br, .gz) — в 3–4 раза меньше */
  await app.register(fastifyStatic, { root: WEB, index: ['index.html'], preCompressed: true });
} else {
  app.get('/', async () => 'Сайт ещё не собран: выполните npm run build');
}

await app.listen({ port: PORT, host: HOST });

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => `http://${n!.address}:${PORT}`);
console.log(`\n«Школа модулей» запущена (${kind}).`);
console.log(`На этом компьютере: http://localhost:${PORT}`);
if (lan.length) console.log(`С телефона в той же сети Wi-Fi: ${lan.join('  ')}`);
console.log('Демо-входы: director / teacher / student, пароль demo2026\n');
