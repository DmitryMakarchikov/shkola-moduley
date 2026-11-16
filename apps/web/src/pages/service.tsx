/* уведомления, профиль, корзина, журнал действий, о платформе */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BRAND, fullName, ROLE_LABEL } from '@pc/core';
import { rich } from '../components/Blocks.tsx';
import { useApp } from '../lib/app.tsx';
import { fmtDate, fmtDateTime } from '../lib/format.ts';
import { applyPrefs, useAction, useLoad } from '../lib/hooks.ts';
import { Async, Badge, Button, Empty, Field, Icon, PageHead } from '../ui/ui.tsx';

/* ---------- уведомления ---------- */
interface Note {
  id: string;
  title: string;
  text: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export const NotificationsPage = () => {
  const { client, refreshUnread } = useApp();
  const nav = useNavigate();
  const list = useLoad(() => client.call<{ unread: number; items: Note[] }>('GET', '/notifications'), []);
  const { run } = useAction();
  const open = async (n: Note) => {
    if (!n.readAt) await client.call('POST', `/notifications/${n.id}/read`).catch(() => undefined);
    refreshUnread();
    if (n.link) nav(n.link);
    else list.reload();
  };
  return (
    <>
      <PageHead title="Уведомления">
        {list.data && list.data.unread > 0 && (
          <Button
            icon="check"
            onClick={async () => {
              if (await run(() => client.call('POST', '/notifications/read-all'), 'Все уведомления прочитаны')) {
                refreshUnread();
                list.reload();
              }
            }}
          >
            Прочитать все
          </Button>
        )}
      </PageHead>
      <Async state={list}>
        {(d) =>
          d.items.length === 0 ? (
            <section className="card">
              <Empty title="Уведомлений нет" text="Здесь появятся сообщения о сданных и проверенных работах, назначенных курсах и решениях по курсам." />
            </section>
          ) : (
            <section className="card">
              <ul className="notes">
                {d.items.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`notes__item ${n.readAt ? '' : 'is-new'}`} onClick={() => void open(n)}>
                      <span className="notes__dot" aria-hidden="true" />
                      <span className="notes__body">
                        <span className="notes__title">
                          {n.title} {!n.readAt && <span className="visually-hidden">(новое)</span>}
                        </span>
                        <span className="notes__text">{rich(n.text)}</span>
                      </span>
                      <span className="notes__time">{fmtDateTime(n.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        }
      </Async>
    </>
  );
};

/* ---------- профиль ---------- */
const readPref = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* приватный режим */
  }
  applyPrefs();
};

export const ProfilePage = () => {
  const { user, institution, client } = useApp();
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [theme, setTheme] = useState(readPref('pc.theme', 'auto'));
  const [scale, setScale] = useState(readPref('pc.scale', '1'));
  const { busy, run } = useAction();
  if (!user) return null;

  return (
    <>
      <PageHead title="Профиль и настройки" />
      <div className="grid grid--2">
        <section className="card">
          <div className="who">
            <span className="who__avatar" aria-hidden="true">
              {user.lastName[0]}
              {user.firstName[0]}
            </span>
            <div>
              <p className="who__name">{fullName(user)}</p>
              <p className="muted">{ROLE_LABEL[user.role]}</p>
            </div>
          </div>
          <dl className="props">
            <dt>Логин</dt>
            <dd>{user.login}</dd>
            {user.email && (
              <>
                <dt>Почта</dt>
                <dd>{user.email}</dd>
              </>
            )}
            {institution && (
              <>
                <dt>Учреждение</dt>
                <dd>{institution.name}</dd>
              </>
            )}
            <dt>В системе с</dt>
            <dd>{fmtDate(user.createdAt)}</dd>
          </dl>
          <p className="muted small">ФИО и логин меняет администратор учреждения.</p>
        </section>

        <section className="card">
          <h2 className="card__title">Внешний вид</h2>
          <div className="form">
            <div className="field">
              <span className="field__label">Тема</span>
              <div className="seg" role="radiogroup" aria-label="Тема">
                {[
                  ['auto', 'Как в системе'],
                  ['light', 'Светлая'],
                  ['dark', 'Тёмная'],
                ].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={theme === v} className={`seg__btn ${theme === v ? 'is-on' : ''}`} onClick={() => (setTheme(v!), writePref('pc.theme', v!))}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field__label">Размер текста</span>
              <div className="seg" role="radiogroup" aria-label="Размер текста">
                {[
                  ['0.9', 'Мельче'],
                  ['1', 'Обычный'],
                  ['1.15', 'Крупнее'],
                  ['1.3', 'Крупный'],
                ].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={scale === v} className={`seg__btn ${scale === v ? 'is-on' : ''}`} onClick={() => (setScale(v!), writePref('pc.scale', v!))}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Смена пароля</h2>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (pw.next !== pw.again) {
                await run(() => Promise.reject(new Error('Новые пароли не совпадают')));
                return;
              }
              if (await run(() => client.call('POST', '/auth/password', { current: pw.current, next: pw.next }), 'Пароль изменён')) setPw({ current: '', next: '', again: '' });
            }}
          >
            <Field label="Текущий пароль">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
            <Field label="Новый пароль" hint="От 8 символов, буквы и цифры">
              {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}
            </Field>
            <Field label="Новый пароль ещё раз">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />}</Field>
            <Button kind="primary" type="submit" busy={busy} disabled={!pw.current || !pw.next}>
              Сменить пароль
            </Button>
          </form>
        </section>

        <TelegramCard />
      </div>
    </>
  );
};

const TelegramCard = () => {
  const { client, refresh } = useApp();
  const st = useLoad(() => client.call<{ available: boolean; botName: string | null; linked: boolean }>('GET', '/telegram').catch(() => ({ available: false, botName: null, linked: false })), []);
  const [link, setLink] = useState<{ code: string; url: string; minutes: number } | null>(null);
  const { busy, run } = useAction();

  /* пока открыта ссылка — проверяем, привязался ли чат */
  useEffect(() => {
    if (!link) return;
    const t = setInterval(() => {
      client
        .call<{ linked: boolean }>('GET', '/telegram')
        .then((s) => {
          if (s.linked) {
            setLink(null);
            st.reload();
            void refresh();
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [link, client, st, refresh]);

  return (
    <section className="card">
      <h2 className="card__title">Уведомления в Telegram</h2>
      <Async state={st}>
        {(s) =>
          !s.available ? (
            <p className="muted">
              {client.mode === 'local' ? 'Бот работает, когда платформа запущена на сервере.' : 'Бот ещё не подключён администратором сервера. Уведомления приходят на сайт — значок колокольчика вверху.'}
            </p>
          ) : s.linked ? (
            <div className="form">
              <p>
                <Badge tone="ok">подключено</Badge> Уведомления приходят в Telegram (бот @{s.botName}).
              </p>
              <Button busy={busy} onClick={async () => (await run(() => client.call('POST', '/telegram/unlink'), 'Telegram отключён')) && st.reload()}>
                Отключить
              </Button>
            </div>
          ) : link ? (
            <div className="form">
              <p>Откройте бота и нажмите «Запустить» — чат привяжется автоматически. Ссылка действует {link.minutes} минут.</p>
              <a className="btn btn--primary btn--lg" href={link.url} target="_blank" rel="noopener noreferrer">
                <Icon name="send" /> Открыть @{s.botName}
              </a>
              <p className="muted small">
                Или отправьте боту сообщение: <code>/start {link.code}</code>
              </p>
            </div>
          ) : (
            <div className="form">
              <p className="muted">Сдали работу, поставили отметку, вернули на доработку — сообщение придёт сразу в Telegram.</p>
              <Button kind="primary" icon="send" busy={busy} onClick={async () => setLink((await run(() => client.call<{ code: string; url: string; minutes: number }>('POST', '/telegram/link'))) ?? null)}>
                Подключить
              </Button>
            </div>
          )
        }
      </Async>
    </section>
  );
};

/* ---------- корзина ---------- */
interface TrashRow {
  table: string;
  kind: string;
  id: string;
  title: string;
  deletedAt: string;
  deletedByName: string;
  expiresAt: string;
}

export const TrashPage = () => {
  const { client, confirm } = useApp();
  const list = useLoad(() => client.call<TrashRow[]>('GET', '/trash'), []);
  const { busy, run } = useAction();
  return (
    <>
      <PageHead title="Корзина" kicker="Удалённое хранится 30 дней, затем стирается навсегда" />
      <Async state={list}>
        {(rows) =>
          rows.length === 0 ? (
            <section className="card">
              <Empty title="Корзина пуста" text="Если что-то удалить по ошибке, его можно будет вернуть отсюда." />
            </section>
          ) : (
            <section className="card">
              <ul className="rows">
                {rows.map((r) => (
                  <li key={`${r.table}/${r.id}`} className="rows__item">
                    <span className="rows__title">
                      <Badge>{r.kind}</Badge> {r.title}
                    </span>
                    <span className="rows__meta">
                      удалил(а) {r.deletedByName || '—'} {fmtDate(r.deletedAt)} · сотрётся {fmtDate(r.expiresAt)}
                    </span>
                    <span className="rows__actions">
                      <Button size="sm" icon="cycle" busy={busy} onClick={async () => (await run(() => client.call('POST', `/trash/${r.table}/${r.id}/restore`), 'Восстановлено')) && list.reload()}>
                        Вернуть
                      </Button>
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="trash"
                        aria-label="Удалить навсегда"
                        onClick={async () => {
                          if (await confirm({ text: `Удалить «${r.title}» навсегда? Вернуть будет нельзя.`, ok: 'Удалить навсегда', danger: true })) {
                            if (await run(() => client.call('DELETE', `/trash/${r.table}/${r.id}`), 'Удалено навсегда')) list.reload();
                          }
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        }
      </Async>
    </>
  );
};

/* ---------- журнал действий ---------- */
interface AuditRow {
  id: string;
  action: string;
  entity: string;
  summary: string;
  createdAt: string;
  actorName: string;
  actorRole: string;
}

const ACTION: Record<string, { label: string; tone: string }> = {
  create: { label: 'создание', tone: 'ok' },
  update: { label: 'изменение', tone: 'info' },
  delete: { label: 'удаление', tone: 'err' },
  restore: { label: 'восстановление', tone: 'ok' },
  grade: { label: 'отметка', tone: 'ok' },
  return: { label: 'возврат', tone: 'warn' },
  archive: { label: 'архив', tone: 'muted' },
  purge: { label: 'стёрто', tone: 'err' },
  status: { label: 'статус', tone: 'info' },
};

export const AuditPage = () => {
  const { client } = useApp();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 350);
    return () => clearTimeout(t);
  }, [q]);
  const list = useLoad(() => client.call<AuditRow[]>('GET', '/audit', undefined, { q: query }), [query]);
  return (
    <>
      <PageHead title="Журнал действий" kicker="Кто, что и когда изменил — последние 300 записей" />
      <div className="filters">
        <Field label="Поиск">{(id) => <input id={id} className="input" type="search" placeholder="Фамилия, курс, действие" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
      </div>
      <Async state={list}>
        {(rows) =>
          rows.length === 0 ? (
            <section className="card">
              <Empty title="Записей не найдено" />
            </section>
          ) : (
            <section className="card">
              <ul className="rows">
                {rows.map((r) => (
                  <li key={r.id} className="rows__item">
                    <Badge tone={ACTION[r.action]?.tone ?? 'muted'}>{ACTION[r.action]?.label ?? r.action}</Badge>
                    <span className="rows__title">{r.summary}</span>
                    <span className="rows__meta">
                      {r.actorName}
                      {r.actorRole ? ` (${r.actorRole.toLowerCase()})` : ''} · {fmtDateTime(r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        }
      </Async>
    </>
  );
};

/* ---------- о платформе и установка приложения ---------- */
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallEvent;
});

export const AboutPage = () => {
  const { client, confirm, user } = useApp();
  const [canInstall, setCanInstall] = useState(!!deferred);
  const standalone = matchMedia('(display-mode: standalone)').matches;
  useEffect(() => {
    const on = () => setCanInstall(true);
    addEventListener('beforeinstallprompt', on);
    return () => removeEventListener('beforeinstallprompt', on);
  }, []);

  return (
    <>
      <PageHead title={`О платформе «${BRAND.name}»`} kicker={BRAND.about} />
      <div className="grid grid--2">
        <section className="card">
          <h2 className="card__title">Что умеет платформа</h2>
          <ul className="outcomes">
            <li>Курсы из модулей: в каждом модуле — лекции, тесты и лабораторные работы</li>
            <li>Шесть типов тестовых заданий с автоматической проверкой и разбором ошибок</li>
            <li>Сдача лабораторных с файлами, версии работ, отметка и возврат на доработку</li>
            <li>Автоматическая выдача вариантов по списку группы</li>
            <li>Роли учреждения: директор, методист, преподаватель, учащийся</li>
            <li>Утверждение курсов методистом перед публикацией</li>
            <li>Журнал успеваемости с выгрузкой в Excel, успеваемость групп для куратора</li>
            <li>Поиск по курсам и материалам: Ctrl+K или «/»</li>
            <li>Словарь терминов курса с карточками и тренажёром</li>
            <li>Анализ заданий теста: что усвоено, какие задания переписать</li>
            <li>Опрос на занятии: ответы группы с телефонов в реальном времени</li>
            <li>Модуль пакетом HTML5 / SCORM для работы без платформы и для СДО</li>
            <li>Уведомления на сайте и в Telegram</li>
            <li>Корзина на 30 дней и журнал действий</li>
            <li>Работает на компьютере, планшете и телефоне, в том числе без интернета</li>
          </ul>
        </section>
        <section className="card">
          <h2 className="card__title">Установить как приложение</h2>
          {standalone ? (
            <p>
              <Badge tone="ok">установлено</Badge> Вы уже работаете в приложении.
            </p>
          ) : canInstall ? (
            <>
              <p className="muted">Значок появится на рабочем столе или на главном экране телефона, приложение откроется в отдельном окне.</p>
              <Button
                kind="primary"
                icon="download"
                onClick={async () => {
                  if (!deferred) return;
                  await deferred.prompt();
                  deferred = null;
                  setCanInstall(false);
                }}
              >
                Установить
              </Button>
            </>
          ) : (
            <ul className="steps-text">
              <li>
                <strong>Компьютер (Chrome, Edge, Яндекс):</strong> значок установки в адресной строке или пункт меню «Установить приложение».
              </li>
              <li>
                <strong>Android:</strong> меню браузера (три точки), пункт «Добавить на главный экран».
              </li>
              <li>
                <strong>iPhone, iPad (Safari):</strong> кнопка «Поделиться», пункт «На экран «Домой».
              </li>
            </ul>
          )}
          <h2 className="card__title card__title--spaced">Где хранятся данные</h2>
          {client.mode === 'server' ? (
            <p>
              <Badge tone="ok">сервер</Badge> Данные хранятся на сервере учреждения, доступны с любого устройства.
            </p>
          ) : (
            <>
              <p>
                <Badge tone="warn">этот браузер</Badge> Платформа работает без сервера: данные хранятся только в этом браузере на этом устройстве.
              </p>
              {user && ['owner', 'director'].includes(user.role) && client.reset && (
                <Button
                  kind="danger"
                  onClick={async () => {
                    if (await confirm({ text: 'Стереть все данные в этом браузере и вернуть демонстрационные? Действие необратимо.', ok: 'Стереть', danger: true })) {
                      await client.reset!();
                      location.reload();
                    }
                  }}
                >
                  Сбросить данные браузера
                </Button>
              )}
            </>
          )}
          <p className="muted small">
            <Link to="/">На главную</Link>
          </p>
        </section>
      </div>
    </>
  );
};
