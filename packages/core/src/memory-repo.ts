/* хранилище в памяти: для автономного режима (с сохранением в IndexedDB) и для тестов */
import { TABLES, type Table, type Tables } from './model.ts';
import type { Repo } from './ports.ts';

export interface Change {
  table: Table;
  id: string;
  row: unknown | null;
}

type Persist = (changes: Change[]) => Promise<void>;

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryRepo implements Repo {
  private data = new Map<Table, Map<string, unknown>>();
  private journal: { table: Table; id: string; before: unknown | undefined }[] | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private persist: Persist;

  constructor(persist: Persist = async () => {}) {
    this.persist = persist;
    for (const t of TABLES) this.data.set(t, new Map());
  }

  /* загрузка сохранённых данных при старте */
  load(table: Table, rows: { id: string }[]) {
    const map = this.map(table);
    for (const r of rows) map.set(r.id, r);
  }

  dump(): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const [t, m] of this.data) out[t] = [...m.values()].map(clone);
    return out;
  }

  private map(table: Table) {
    const m = this.data.get(table);
    if (!m) throw new Error(`Нет таблицы ${table}`);
    return m;
  }

  async all<T extends Table>(table: T) {
    return [...this.map(table).values()].map((r) => clone(r) as Tables[T]);
  }

  async get<T extends Table>(table: T, id: string) {
    const r = this.map(table).get(id);
    return r ? (clone(r) as Tables[T]) : undefined;
  }

  async find<T extends Table>(table: T, where: Partial<Tables[T]>) {
    const keys = Object.keys(where) as (keyof Tables[T])[];
    const out: Tables[T][] = [];
    for (const r of this.map(table).values()) {
      const row = r as Tables[T];
      if (keys.every((k) => row[k] === where[k])) out.push(clone(row));
    }
    return out;
  }

  async list<T extends Table>(table: T, field: keyof Tables[T] & string, values: string[], omit: (keyof Tables[T] & string)[] = []) {
    const want = new Set(values);
    const out: Tables[T][] = [];
    for (const r of this.map(table).values()) {
      const row = r as Record<string, unknown>;
      if (!want.has(row[field] as string)) continue;
      /* тяжёлые поля не копируем */
      const light = { ...row };
      for (const k of omit) delete light[k];
      out.push(clone(light) as unknown as Tables[T]);
    }
    return out;
  }

  private async write(table: Table, id: string, row: unknown | null) {
    const m = this.map(table);
    const before = m.get(id);
    if (this.journal) this.journal.push({ table, id, before: before === undefined ? undefined : clone(before) });
    if (row === null) m.delete(id);
    else m.set(id, clone(row));
    if (!this.journal) await this.persist([{ table, id, row }]);
  }

  async insert<T extends Table>(table: T, row: Tables[T]) {
    if (this.map(table).has(row.id)) throw new Error(`Дубликат ключа ${table}.${row.id}`);
    await this.write(table, row.id, row);
    return clone(row);
  }

  async update<T extends Table>(table: T, id: string, patch: Partial<Tables[T]>) {
    const cur = this.map(table).get(id);
    if (!cur) throw new Error(`Нет записи ${table}.${id}`);
    const next = { ...(cur as object), ...patch, id } as Tables[T];
    await this.write(table, id, next);
    return clone(next);
  }

  async remove<T extends Table>(table: T, id: string) {
    if (this.map(table).has(id)) await this.write(table, id, null);
  }

  /* транзакция: при ошибке все изменения откатываются, при успехе сохраняются разом */
  async tx<R>(fn: (repo: Repo) => Promise<R>): Promise<R> {
    if (this.journal) return fn(this);
    const run = this.lock.then(async () => {
      this.journal = [];
      try {
        const result = await fn(this);
        const touched = new Map<string, Change>();
        for (const j of this.journal) {
          const row = this.map(j.table).get(j.id);
          touched.set(`${j.table}/${j.id}`, { table: j.table, id: j.id, row: row === undefined ? null : clone(row) });
        }
        this.journal = null;
        await this.persist([...touched.values()]);
        return result;
      } catch (e) {
        const j = this.journal ?? [];
        this.journal = null;
        for (let i = j.length - 1; i >= 0; i--) {
          const step = j[i]!;
          const m = this.map(step.table);
          if (step.before === undefined) m.delete(step.id);
          else m.set(step.id, step.before);
        }
        throw e;
      }
    });
    this.lock = run.catch(() => undefined);
    return run;
  }
}
