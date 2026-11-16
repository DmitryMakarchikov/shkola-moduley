/* выбор режима: если рядом есть сервер — работаем с ним, иначе автономно в браузере */
import type { Client } from './client.ts';
import { createServerClient } from './server-client.ts';

export * from './client.ts';

export const createClient = async (): Promise<Client> => {
  if (location.protocol !== 'file:') {
    const page = location.href.split('#')[0] ?? location.href;
    const apiBase = new URL('./api', page).pathname;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${apiBase}/health`, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      const data = (await res.json()) as { mode?: string };
      if (res.ok && data.mode === 'server') return createServerClient(apiBase);
    } catch {
      /* сервера нет — автономный режим */
    }
  }
  /* автономный модуль (ядро в браузере) грузится только когда нужен */
  const { createLocalClient } = await import('./local-client.ts');
  return createLocalClient();
};
