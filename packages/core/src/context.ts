/* контекст запроса и общие помощники сервисов */
import { forbidden, notFound, unauthorized } from './errors.ts';
import type { Base, Role, Table, Tables, User } from './model.ts';
import type { Ports } from './ports.ts';

export interface Ctx extends Ports {
  user: User | null;
  ip: string;
}

export const needUser = (ctx: Ctx): User => {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
};

export const needRole = (ctx: Ctx, ...roles: Role[]): User => {
  const u = needUser(ctx);
  if (!roles.includes(u.role)) throw forbidden();
  return u;
};

export const iso = (ctx: Ctx) => ctx.now().toISOString();

export const base = (ctx: Ctx): Base => {
  const t = iso(ctx);
  return { id: ctx.id(), createdAt: t, updatedAt: t, deletedAt: null, deletedBy: null };
};

export const touch = (ctx: Ctx) => ({ updatedAt: iso(ctx) });

export const alive = <T extends Base>(rows: T[]) => rows.filter((r) => !r.deletedAt);

/* живая запись или ошибка «не найден» */
export const getAlive = async <T extends Table>(ctx: Ctx, table: T, id: string, what: string) => {
  const row = await ctx.repo.get(table, id);
  if (!row || row.deletedAt) throw notFound(what);
  return row as Tables[T];
};

/* мягкое удаление: запись попадает в корзину на 30 дней */
export const softDelete = async (ctx: Ctx, table: Table, id: string) => {
  const u = needUser(ctx);
  await ctx.repo.update(table, id, { deletedAt: iso(ctx), deletedBy: u.id, updatedAt: iso(ctx) } as never);
};

export const audit = async (
  ctx: Ctx,
  action: string,
  entity: Table,
  entityId: string,
  summary: string,
  institutionId: string | null = ctx.user?.institutionId ?? null,
) => {
  await ctx.repo.insert('audit', {
    ...base(ctx),
    institutionId,
    actorId: ctx.user?.id ?? 'system',
    action,
    entity,
    entityId,
    summary,
  });
};

export const notify = async (ctx: Ctx, userIds: string[], title: string, text: string, link: string) => {
  const ids = [...new Set(userIds)].filter((id) => id !== ctx.user?.id);
  for (const userId of ids) {
    await ctx.repo.insert('notifications', { ...base(ctx), userId, title, text, link, readAt: null });
  }
  if (ids.length) ctx.events.publish(ids, { type: 'notification', data: { title, text, link } });
};

/* случайный код из букв и цифр без похожих символов (0/O, 1/I) */
export const code = (len = 6) => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
};

export const tempPassword = () => `${code(4).toLowerCase()}-${code(4).toLowerCase()}-${code(2).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) % 10))}`;

/* код приглашения в группу: 8 случайных символов без похожих (0/O, 1/I) — 10^12 вариантов, подобрать нельзя */
export const joinCode = () => code(8);
export const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const strongCode = (s: string) => /^[A-HJ-NP-Z2-9]{8}$/.test(s);
