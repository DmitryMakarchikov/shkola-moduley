/* загрузка данных и действия с обработкой ошибок */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from './app.tsx';

export const useLoad = <T,>(fn: () => Promise<T>, deps: unknown[] = []) => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []), setData };
};

/* действие с индикатором и сообщением об ошибке */
export const useAction = () => {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <R,>(fn: () => Promise<R>, ok?: string): Promise<R | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (ok) toast(ok);
        return r;
      } catch (e) {
        toast((e as Error).message, 'err');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
};

/* настройки отображения: тема и размер шрифта */
export const applyPrefs = () => {
  let theme = 'auto';
  let scale = '1';
  try {
    theme = localStorage.getItem('pc.theme') ?? 'auto';
    scale = localStorage.getItem('pc.scale') ?? '1';
  } catch {
    /* приватный режим */
  }
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--scale', scale);
};
