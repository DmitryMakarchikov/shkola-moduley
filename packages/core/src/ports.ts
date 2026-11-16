/* порты: всё, что зависит от среды (браузер или сервер), передаётся в ядро снаружи */
import type { Table, Tables } from './model.ts';

export interface Repo {
  all<T extends Table>(table: T): Promise<Tables[T][]>;
  get<T extends Table>(table: T, id: string): Promise<Tables[T] | undefined>;
  find<T extends Table>(table: T, where: Partial<Tables[T]>): Promise<Tables[T][]>;
  /* пакетная выборка по списку значений поля; omit — тяжёлые поля, которые не нужны (тексты лекций, банки заданий) */
  list<T extends Table>(table: T, field: keyof Tables[T] & string, values: string[], omit?: (keyof Tables[T] & string)[]): Promise<Tables[T][]>;
  insert<T extends Table>(table: T, row: Tables[T]): Promise<Tables[T]>;
  update<T extends Table>(table: T, id: string, patch: Partial<Tables[T]>): Promise<Tables[T]>;
  remove<T extends Table>(table: T, id: string): Promise<void>;
  tx<R>(fn: (repo: Repo) => Promise<R>): Promise<R>;
}

export interface Hasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
  /* случайный токен сессии и его отпечаток для хранения */
  token(): string;
  digest(token: string): Promise<string>;
}

export interface FileStore {
  put(id: string, data: Uint8Array | Blob, mime: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface Events {
  publish(userIds: string[], event: { type: string; data?: unknown }): void;
}

export interface Ports {
  repo: Repo;
  hasher: Hasher;
  files: FileStore;
  events: Events;
  now(): Date;
  id(): string;
  /* бот Telegram, если настроен на сервере */
  bot?: { name: string } | null;
}
