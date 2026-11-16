/* хранилище PostgreSQL через Drizzle ORM: встроенная PGlite (без установки) или сервер по DATABASE_URL.
   Таблицы создаются миграциями из папки drizzle; запросы внутри транзакции идут через её соединение */
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, getTableColumns, inArray, isNull, type SQL } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { drizzle as drizzleLite } from 'drizzle-orm/pglite';
import { migrate as migrateLite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import type { Repo, Table, Tables } from '@pc/core';
import { tables } from './schema.ts';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/* общий вид базы для обоих драйверов */
interface Db {
  select(fields?: Record<string, PgColumn>): { from(t: PgTable): { where(c?: SQL): Promise<Record<string, unknown>[]> } & Promise<Record<string, unknown>[]> };
  insert(t: PgTable): { values(v: Record<string, unknown>): { returning(): Promise<Record<string, unknown>[]> } };
  update(t: PgTable): { set(v: Record<string, unknown>): { where(c: SQL): { returning(): Promise<Record<string, unknown>[]> } } };
  delete(t: PgTable): { where(c: SQL): Promise<unknown> };
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>;
}

export const openRepo = async (opts: { databaseUrl?: string; dataDir?: string }) => {
  let db: Db;
  let close: () => Promise<void>;
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 20 });
    const d = drizzlePg(pool);
    await migratePg(d, { migrationsFolder: MIGRATIONS });
    db = d as unknown as Db;
    close = () => pool.end();
  } else {
    /* без dataDir база живёт в памяти — так запускаются тесты */
    const client = opts.dataDir ? await PGlite.create(opts.dataDir) : await PGlite.create();
    const d = drizzleLite(client);
    await migrateLite(d, { migrationsFolder: MIGRATIONS });
    db = d as unknown as Db;
    close = () => client.close();
  }

  const als = new AsyncLocalStorage<Db>();
  const q = (): Db => als.getStore() ?? db;
  const tbl = (t: Table) => tables[t] as unknown as PgTable;
  const cols = (t: Table) => getTableColumns(tbl(t)) as Record<string, PgColumn>;

  /* в запрос попадают только поля, для которых есть столбец */
  const pick = (t: Table, row: object) => {
    const c = cols(t);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (k in c && v !== undefined) out[k] = v;
    return out;
  };

  const repo: Repo = {
    async all<T extends Table>(table: T) {
      return (await q().select().from(tbl(table))) as unknown as Tables[T][];
    },
    async get<T extends Table>(table: T, id: string) {
      const rows = await q().select().from(tbl(table)).where(eq(cols(table).id!, id));
      return rows[0] as unknown as Tables[T] | undefined;
    },
    async find<T extends Table>(table: T, where: Partial<Tables[T]>) {
      const c = cols(table);
      const conds = Object.entries(where)
        .filter(([k, v]) => k in c && v !== undefined)
        .map(([k, v]) => (v === null ? isNull(c[k]!) : eq(c[k]!, v)));
      return (await q().select().from(tbl(table)).where(and(...conds))) as unknown as Tables[T][];
    },
    async list<T extends Table>(table: T, field: string, values: string[], omit: string[] = []) {
      if (!values.length) return [];
      const c = cols(table);
      /* только нужные столбцы: тяжёлые JSON-поля не читаются из базы */
      const fields = Object.fromEntries(Object.entries(c).filter(([k]) => !omit.includes(k))) as Record<string, PgColumn>;
      return (await q().select(fields).from(tbl(table)).where(inArray(c[field]!, values))) as unknown as Tables[T][];
    },
    async insert<T extends Table>(table: T, row: Tables[T]) {
      const [saved] = await q().insert(tbl(table)).values(pick(table, row)).returning();
      return saved as unknown as Tables[T];
    },
    async update<T extends Table>(table: T, id: string, patch: Partial<Tables[T]>) {
      const { id: _id, ...rest } = pick(table, patch);
      const [saved] = await q().update(tbl(table)).set(rest).where(eq(cols(table).id!, id)).returning();
      if (!saved) throw new Error(`Нет записи ${table}.${id}`);
      return saved as unknown as Tables[T];
    },
    async remove<T extends Table>(table: T, id: string) {
      await q().delete(tbl(table)).where(eq(cols(table).id!, id));
    },
    async tx<R>(fn: (repo: Repo) => Promise<R>) {
      if (als.getStore()) return fn(repo);
      return db.transaction((tx) => als.run(tx, () => fn(repo)));
    },
  };
  return { repo, close, kind: opts.databaseUrl ? 'PostgreSQL' : 'PGlite' };
};
