/* состояние приложения: клиент API, вошедший пользователь, уведомления, подтверждения */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Institution, PublicUser } from '@pc/core';
import type { Client } from '../api/index.ts';

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'err' | 'info';
}

interface ConfirmOpts {
  title?: string;
  text: string;
  ok?: string;
  danger?: boolean;
}

interface AppState {
  client: Client;
  user: PublicUser | null;
  institution: Institution | null;
  unread: number;
  login(login: string, password: string): Promise<void>;
  join(data: Record<string, string>): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  refreshUnread(): void;
  toast(text: string, tone?: Toast['tone']): void;
  confirm(opts: ConfirmOpts): Promise<boolean>;
}

const Ctx = createContext<AppState | null>(null);

export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp вне AppProvider');
  return v;
};

export const AppProvider = ({ client, children }: { client: Client; children: ReactNode }) => {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [ready, setReady] = useState(false);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'err' ? 6000 : 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await client.call<{ user: PublicUser; institution: Institution | null }>('GET', '/auth/me');
      setUser(me.user);
      setInstitution(me.institution);
    } catch {
      setUser(null);
      setInstitution(null);
    } finally {
      setReady(true);
    }
  }, [client]);

  const refreshUnread = useCallback(() => {
    if (!user) return;
    client
      .call<{ unread: number }>('GET', '/notifications')
      .then((n) => setUnread(n.unread))
      .catch(() => undefined);
  }, [client, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* уведомления: событие от сервера или проверка раз в минуту */
  useEffect(() => {
    if (!user) return;
    refreshUnread();
    const off = client.subscribe((e) => {
      if (e.type === 'resync') refreshUnread();
      if (e.type === 'notification') {
        refreshUnread();
        const title = (e.data as { title?: string } | undefined)?.title;
        if (title) toast(`Новое уведомление: ${title}`, 'info');
      }
    });
    const timer = setInterval(refreshUnread, 60_000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [client, user, refreshUnread, toast]);

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setDialog({ ...opts, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
  }, [dialog]);

  const closeDialog = (v: boolean) => {
    dialogRef.current?.close();
    dialog?.resolve(v);
    setDialog(null);
  };

  const value = useMemo<AppState>(
    () => ({
      client,
      user,
      institution,
      unread,
      async login(login, password) {
        await client.call('POST', '/auth/login', { login, password });
        await refresh();
      },
      async join(data) {
        await client.call('POST', '/auth/join', data);
        await refresh();
      },
      async logout() {
        await client.call('POST', '/auth/logout').catch(() => undefined);
        setUser(null);
        setInstitution(null);
      },
      refresh,
      refreshUnread,
      toast,
      confirm,
    }),
    [client, user, institution, unread, refresh, refreshUnread, toast, confirm],
  );

  if (!ready) return <div className="splash">Загрузка…</div>;

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* уведомления */}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === 'err' ? 'alert' : 'status'}>
            {t.text}
          </div>
        ))}
      </div>
      {/* подтверждение */}
      <dialog ref={dialogRef} className="modal" onCancel={() => closeDialog(false)}>
        {dialog && (
          <div className="modal__panel modal__panel--small">
            <h2 className="modal__title">{dialog.title ?? 'Подтвердите действие'}</h2>
            <p className="modal__text">{dialog.text}</p>
            <div className="modal__foot">
              <button className="btn" onClick={() => closeDialog(false)}>
                Отмена
              </button>
              <button className={`btn ${dialog.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => closeDialog(true)} autoFocus>
                {dialog.ok ?? 'Подтвердить'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </Ctx.Provider>
  );
};
