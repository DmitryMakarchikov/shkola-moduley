/* серверный режим: запросы к API по HTTPS, сессия в httpOnly-cookie */
import type { FileRow } from '@pc/core';
import { ApiError, cleanQuery, type Client } from './client.ts';

export const createServerClient = (base: string): Client => {
  const headers = (json: boolean): Record<string, string> => ({
    'x-pc-request': '1',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  });

  const parse = async (res: Response) => {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? 'Сервер не отвечает. Попробуйте ещё раз');
    return data;
  };

  return {
    mode: 'server',
    async call(method, path, body, query) {
      const qs = new URLSearchParams(cleanQuery(query)).toString();
      const res = await fetch(`${base}${path}${qs ? `?${qs}` : ''}`, {
        method,
        credentials: 'same-origin',
        headers: headers(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }).catch(() => {
        throw new ApiError(0, 'Нет связи с сервером');
      });
      return (await parse(res)) as never;
    },
    async upload(file, scope) {
      const fd = new FormData();
      fd.append('scope', scope);
      fd.append('file', file);
      const res = await fetch(`${base}/files`, { method: 'POST', credentials: 'same-origin', headers: headers(false), body: fd });
      return (await parse(res)) as unknown as FileRow;
    },
    async fileUrl(id) {
      return `${base}/files/${encodeURIComponent(id)}`;
    },
    subscribe(fn) {
      /* соединение уведомлений держит только видимая вкладка: по HTTP/1.1 браузер открывает к серверу не больше 6 соединений,
         и несколько открытых вкладок иначе заняли бы их все — остальные запросы ждали бы бесконечно */
      let es: EventSource | null = null;
      const open = () => {
        if (es) return;
        es = new EventSource(`${base}/events`);
        es.onmessage = (m) => {
          try {
            fn(JSON.parse(m.data));
          } catch {
            /* служебное сообщение */
          }
        };
      };
      const close = () => {
        es?.close();
        es = null;
      };
      const sync = () => {
        if (document.visibilityState === 'hidden') return close();
        if (!es) {
          open();
          /* пока вкладка была скрыта, события не приходили — пусть приложение сверит данные */
          fn({ type: 'resync' });
        }
      };
      if (document.visibilityState !== 'hidden') open();
      document.addEventListener('visibilitychange', sync);
      return () => {
        document.removeEventListener('visibilitychange', sync);
        close();
      };
    },
  };
};
