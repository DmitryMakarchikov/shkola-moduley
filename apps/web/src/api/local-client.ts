/* автономный режим: то же ядро работает прямо в браузере, данные — в IndexedDB */
import {
  AppError,
  MemoryRepo,
  TABLES,
  createFile,
  dispatch,
  fileAccess,
  purgeExpired,
  upgradeData,
  resolveSession,
  seedDemo,
  type CoursePackage,
  type Change,
  type Hasher,
  type Ports,
} from '@pc/core';
import { ApiError, cleanQuery, type Client } from './client.ts';

const DB_NAME = 'polny-cikl';
const TOKEN = 'pc.token';

/* IndexedDB */
const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

const openDb = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

const writeChanges = (db: IDBDatabase, changes: Change[]) =>
  new Promise<void>((res, rej) => {
    if (!changes.length) return res();
    const tx = db.transaction([...new Set(changes.map((c) => c.table))], 'readwrite');
    for (const c of changes) {
      const store = tx.objectStore(c.table);
      if (c.row === null) store.delete(c.id);
      else store.put(c.row);
    }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });

/* пароли: PBKDF2 через WebCrypto */
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from((s.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
const pbkdf2 = async (password: string, salt: Uint8Array) => {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 120_000 }, key, 256);
};

const hasher: Hasher = {
  async hash(p) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2$${hex(salt)}$${hex(await pbkdf2(p, salt))}`;
  },
  async verify(p, h) {
    const [kind, salt, want] = h.split('$');
    if (kind !== 'pbkdf2' || !salt || !want) return false;
    const got = hex(await pbkdf2(p, unhex(salt)));
    let diff = got.length ^ want.length;
    for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
  },
  token() {
    const b = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c] ?? '');
  },
  async digest(t) {
    return hex(await crypto.subtle.digest('SHA-256', enc.encode(t)));
  },
};

const safeStore = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* приватный режим */
    }
  },
  remove: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* приватный режим */
    }
  },
};

const toApiError = (e: unknown) => {
  if (e instanceof AppError) return new ApiError(e.status, e.message);
  console.error(e);
  return new ApiError(500, 'Внутренняя ошибка. Попробуйте ещё раз');
};

export const createLocalClient = async (): Promise<Client> => {
  const db = await openDb();
  const repo = new MemoryRepo((changes) => writeChanges(db, changes));
  for (const t of TABLES) repo.load(t, (await req(db.transaction(t).objectStore(t).getAll())) as { id: string }[]);

  const listeners = new Set<(e: { type: string; data?: unknown }) => void>();
  let currentUserId: string | null = null;

  const ports: Ports = {
    repo,
    hasher,
    files: {
      async put(id, data, mime) {
        const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
        await req(db.transaction('blobs', 'readwrite').objectStore('blobs').put(blob, id));
      },
      async remove(id) {
        await req(db.transaction('blobs', 'readwrite').objectStore('blobs').delete(id));
      },
    },
    events: {
      publish(ids, event) {
        if (currentUserId && ids.includes(currentUserId)) listeners.forEach((fn) => fn(event));
      },
    },
    now: () => new Date(),
    id: () => crypto.randomUUID(),
  };

  /* пакет курса грузится только при первом запуске, когда база пустая */
  if (!(await ports.repo.all('institutions')).length) {
    const pkg = (await import('../../../../packages/course-trpo/course.json')).default as unknown as CoursePackage;
    await seedDemo(ports, pkg);
  }
  await upgradeData(ports);
  await purgeExpired(ports);

  const token = () => safeStore.get(TOKEN);
  const userCtx = async () => {
    const user = await resolveSession(ports, token());
    if (!user) throw new ApiError(401, 'Войдите в систему');
    return { ...ports, user, ip: 'local' };
  };

  return {
    mode: 'local',
    async call(method, path, body, query) {
      try {
        const res = (await dispatch(ports, method, path, { query: cleanQuery(query), body: body ?? null, token: token() })) as Record<string, unknown>;
        if ((path === '/auth/login' || path === '/auth/join') && typeof res.token === 'string') {
          safeStore.set(TOKEN, res.token);
          currentUserId = (res.user as { id: string }).id;
          return { user: res.user } as never;
        }
        if (path === '/auth/logout') {
          safeStore.remove(TOKEN);
          currentUserId = null;
        }
        if (path === '/auth/me') currentUserId = (res.user as { id: string }).id;
        return res as never;
      } catch (e) {
        throw toApiError(e);
      }
    },
    async upload(file, scope) {
      try {
        return await createFile(await userCtx(), { name: file.name, mime: file.type, size: file.size, scope }, file);
      } catch (e) {
        throw e instanceof ApiError ? e : toApiError(e);
      }
    },
    async fileUrl(id) {
      try {
        await fileAccess(await userCtx(), id);
      } catch (e) {
        throw e instanceof ApiError ? e : toApiError(e);
      }
      const blob = (await req(db.transaction('blobs').objectStore('blobs').get(id))) as Blob | undefined;
      if (!blob) throw new ApiError(404, 'Файл не найден');
      return URL.createObjectURL(blob);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async reset() {
      db.close();
      safeStore.remove(TOKEN);
      await req(indexedDB.deleteDatabase(DB_NAME) as unknown as IDBRequest<unknown>).catch(() => undefined);
      location.reload();
    },
  };
};
