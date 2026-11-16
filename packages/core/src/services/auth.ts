/* вход, сессии, смена пароля, присоединение к группе по коду */
import { base, iso, needUser, normCode, type Ctx } from '../context.ts';
import { bad, conflict, forbidden, notFound, tooMany, unauthorized } from '../errors.ts';
import { publicUser, type User } from '../model.ts';
import type { Ports } from '../ports.ts';
import { login as loginOf, obj, password, str } from '../validate.ts';

const SESSION_DAYS = 14;
const MAX_FAILS = 5;
const LOCK_MIN = 15;

const findByLogin = async (ctx: Ports, login: string) =>
  (await ctx.repo.find('users', { login })).find((u) => !u.deletedAt);

const openSession = async (ctx: Ctx, user: User) => {
  const token = ctx.hasher.token();
  const now = ctx.now();
  await ctx.repo.insert('sessions', {
    ...base(ctx),
    userId: user.id,
    tokenHash: await ctx.hasher.digest(token),
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
  });
  return token;
};

export const login = async (ctx: Ctx, input: unknown) => {
  const body = obj(input);
  const lg = str(body.login, 'Логин', { max: 40 }).toLowerCase();
  const pw = typeof body.password === 'string' ? body.password : '';
  const user = await findByLogin(ctx, lg);
  const now = ctx.now();
  /* одинаковое сообщение для «нет логина» и «неверный пароль» — не подсказываем, какие логины есть */
  if (!user) throw unauthorized('Неверный логин или пароль');
  if (user.lockedUntil && new Date(user.lockedUntil) > now) {
    throw tooMany(`Слишком много неудачных попыток. Попробуйте через ${LOCK_MIN} минут`);
  }
  if (user.status === 'blocked') throw forbidden('Учётная запись заблокирована. Обратитесь к директору');
  if (!(await ctx.hasher.verify(pw, user.passwordHash))) {
    const fails = user.failedLogins + 1;
    const lock = fails >= MAX_FAILS;
    await ctx.repo.update('users', user.id, {
      failedLogins: lock ? 0 : fails,
      lockedUntil: lock ? new Date(now.getTime() + LOCK_MIN * 60_000).toISOString() : null,
    });
    throw unauthorized('Неверный логин или пароль');
  }
  const updated = await ctx.repo.update('users', user.id, {
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: now.toISOString(),
  });
  const token = await openSession(ctx, updated);
  return { token, user: publicUser(updated) };
};

/* пользователь по токену; просроченные сессии удаляются */
export const resolveSession = async (ports: Ports, token: string | null | undefined): Promise<User | null> => {
  if (!token) return null;
  const tokenHash = await ports.hasher.digest(token);
  const [session] = await ports.repo.find('sessions', { tokenHash });
  if (!session) return null;
  if (new Date(session.expiresAt) < ports.now()) {
    await ports.repo.remove('sessions', session.id);
    return null;
  }
  const user = await ports.repo.get('users', session.userId);
  if (!user || user.deletedAt || user.status !== 'active') return null;
  return user;
};

export const logout = async (ctx: Ctx, token: string | null) => {
  if (!token) return { ok: true };
  const tokenHash = await ctx.hasher.digest(token);
  for (const s of await ctx.repo.find('sessions', { tokenHash })) await ctx.repo.remove('sessions', s.id);
  return { ok: true };
};

export const me = async (ctx: Ctx) => {
  const u = needUser(ctx);
  const institution = u.institutionId ? await ctx.repo.get('institutions', u.institutionId) : null;
  return { user: publicUser(u), institution: institution ?? null };
};

export const changePassword = async (ctx: Ctx, input: unknown) => {
  const u = needUser(ctx);
  const body = obj(input);
  const current = typeof body.current === 'string' ? body.current : '';
  if (!(await ctx.hasher.verify(current, u.passwordHash))) throw bad('Текущий пароль указан неверно');
  const next = password(body.next);
  if (next === current) throw bad('Новый пароль должен отличаться от текущего');
  await ctx.repo.update('users', u.id, {
    passwordHash: await ctx.hasher.hash(next),
    mustChangePassword: false,
    updatedAt: iso(ctx),
  });
  return { ok: true };
};

/* учащийся сам создаёт учётную запись по коду группы, который выдал куратор */
export const joinGroup = async (ctx: Ctx, input: unknown) => {
  const body = obj(input);
  const joinCode = normCode(str(body.code, 'Код группы', { max: 20 }));
  const group = joinCode.length === 8 ? (await ctx.repo.find('groups', { joinCode })).find((g) => !g.deletedAt) : undefined;
  if (!group) throw bad('Код группы не подошёл. Уточните код у куратора: 8 латинских букв и цифр');
  const lg = loginOf(body.login);
  if (await findByLogin(ctx, lg)) throw conflict('Такой логин уже занят');
  const pw = password(body.password);
  return ctx.repo.tx(async () => {
    const user: User = {
      ...base(ctx),
      institutionId: group.institutionId,
      role: 'student',
      login: lg,
      lastName: str(body.lastName, 'Фамилия', { max: 60 }),
      firstName: str(body.firstName, 'Имя', { max: 60 }),
      middleName: str(body.middleName, 'Отчество', { max: 60, optional: true }),
      email: str(body.email, 'Электронная почта', { max: 120, optional: true }),
      passwordHash: await ctx.hasher.hash(pw),
      status: 'active',
      mustChangePassword: false,
      lastLoginAt: iso(ctx),
      failedLogins: 0,
      lockedUntil: null,
    };
    await ctx.repo.insert('users', user);
    await ctx.repo.insert('groupMembers', { ...base(ctx), groupId: group.id, studentId: user.id });
    const token = await openSession(ctx, user);
    return { token, user: publicUser(user) };
  });
};
