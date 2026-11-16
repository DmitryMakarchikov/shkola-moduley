/* поиск по платформе: кнопка в шапке и окно поиска (Ctrl+K или «/»).
   Ищет в курсах, темах, лекциях, терминах, тестах, лабораторных; сотрудникам — ещё группы и учащиеся.
   Разделы платформы находятся сразу, без запроса к серверу */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { findRanges, hasWords, queryWords, type Role, type SearchHit, type SearchKind } from '@pc/core';
import { useApp } from '../lib/app.tsx';
import { Icon } from '../ui/ui.tsx';

/* подсветка найденных слов */
export const Hl = ({ text, words }: { text: string; words: string[] }) => {
  if (!words.length || !text) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  findRanges(text, words).forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
};

interface Page {
  title: string;
  link: string;
  icon: string;
  roles: Role[];
  /* по каким словам ещё находится раздел */
  keys: string;
}

const ALL: Role[] = ['owner', 'director', 'methodist', 'teacher', 'student'];
const STAFF: Role[] = ['owner', 'director', 'methodist', 'teacher'];

const PAGES: Page[] = [
  { title: 'Главная', link: '/', icon: 'home', roles: ALL, keys: 'сводка начало' },
  { title: 'Мои курсы', link: '/learn', icon: 'book', roles: ['student'], keys: 'обучение учеба материалы' },
  { title: 'Курсы', link: '/courses', icon: 'book', roles: STAFF, keys: 'конструктор модули редактор создать курс' },
  { title: 'Проверка работ', link: '/review', icon: 'inbox', roles: STAFF, keys: 'лабораторные сдачи очередь проверить' },
  { title: 'Успеваемость', link: '/progress', icon: 'chart', roles: STAFF, keys: 'долги должники группы куратор риск отличники' },
  { title: 'Журнал успеваемости', link: '/journal', icon: 'table', roles: STAFF, keys: 'отметки оценки ведомость excel' },
  { title: 'Группы и отделения', link: '/structure', icon: 'building', roles: STAFF, keys: 'группа отделение дисциплины код приглашения' },
  { title: 'Люди и роли', link: '/people', icon: 'users', roles: ['owner', 'director'], keys: 'пользователи учетные записи пароль сброс' },
  { title: 'Учреждения', link: '/institutions', icon: 'building', roles: ['owner'], keys: 'колледж школа' },
  { title: 'Журнал действий', link: '/audit', icon: 'history', roles: ['owner', 'director'], keys: 'аудит история изменения' },
  { title: 'Корзина', link: '/trash', icon: 'trash', roles: ['owner', 'director', 'teacher'], keys: 'удаленные восстановить' },
  { title: 'Уведомления', link: '/notifications', icon: 'bell', roles: ALL, keys: 'сообщения новости' },
  { title: 'Профиль и настройки', link: '/profile', icon: 'user', roles: ALL, keys: 'пароль тема темная светлая шрифт telegram телеграм бот' },
  { title: 'О платформе', link: '/about', icon: 'info', roles: ALL, keys: 'справка помощь версия' },
];

const KIND: Record<SearchKind | 'page', { label: string; icon: string }> = {
  page: { label: 'Разделы', icon: 'home' },
  term: { label: 'Термины', icon: 'test' },
  module: { label: 'Темы', icon: 'book' },
  lecture: { label: 'Лекции', icon: 'lecture' },
  test: { label: 'Тесты', icon: 'test' },
  lab: { label: 'Лабораторные', icon: 'lab' },
  course: { label: 'Курсы', icon: 'book' },
  group: { label: 'Группы', icon: 'users' },
  student: { label: 'Учащиеся', icon: 'user' },
};
const ORDER: (SearchKind | 'page')[] = ['page', 'term', 'module', 'lecture', 'test', 'lab', 'course', 'group', 'student'];

type Row = { kind: SearchKind | 'page'; key: string; title: string; sub: string; snippet: string; link: string; icon: string };

const RECENT = 'pc.recent-search';
const readRecent = (): string[] => {
  try {
    return (JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[]).slice(0, 5);
  } catch {
    return [];
  }
};
const saveRecent = (q: string) => {
  try {
    localStorage.setItem(RECENT, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 5)));
  } catch {
    /* хранилище недоступно */
  }
};

export const SearchBox = () => {
  const { client, user } = useApp();
  const nav = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const seq = useRef(0);

  /* Ctrl+K (в любой раскладке) и «/» вне полей ввода */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      if (((e.ctrlKey || e.metaKey) && e.code === 'KeyK') || (e.key === '/' && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setRecent(readRecent());
      setTimeout(() => input.current?.select(), 0);
    }
    if (!open && d.open) d.close();
  }, [open]);

  /* запрос к серверу — после паузы в наборе */
  const words = useMemo(() => queryWords(q), [q]);
  useEffect(() => {
    if (!open) return;
    if (!words.length) {
      setHits([]);
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      client
        .call<{ hits: SearchHit[] }>('GET', '/search', undefined, { q })
        .then((r) => my === seq.current && setHits(r.hits))
        .catch(() => my === seq.current && setHits([]))
        .finally(() => my === seq.current && setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q, words.length, open, client]);

  const role = user?.role ?? 'student';
  const rows = useMemo<Row[]>(() => {
    const pages = PAGES.filter((p) => p.roles.includes(role));
    const found = words.length ? pages.filter((p) => hasWords(`${p.title} ${p.keys}`, words)) : pages.slice(0, 6);
    const all: Row[] = [
      ...found.map((p) => ({ kind: 'page' as const, key: `p:${p.link}`, title: p.title, sub: 'Раздел платформы', snippet: '', link: p.link, icon: p.icon })),
      ...hits.map((h) => ({ kind: h.kind, key: `${h.kind}:${h.id}`, title: h.title, sub: h.sub, snippet: h.snippet, link: h.link, icon: KIND[h.kind].icon })),
    ];
    return ORDER.flatMap((k) => all.filter((r) => r.kind === k));
  }, [hits, words, role]);

  useEffect(() => setActive(0), [rows]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (r: Row | undefined) => {
    if (!r) return;
    if (q.trim().length >= 2) saveRecent(q.trim());
    setOpen(false);
    nav(r.link);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(rows[active]);
    }
  };

  let i = -1;
  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setOpen(true)} aria-label="Поиск" aria-keyshortcuts="Control+K">
        <Icon name="search" size={18} />
        <span className="search-trigger__text">Поиск по курсам и материалам</span>
        <kbd className="search-trigger__kbd">Ctrl K</kbd>
      </button>
      <dialog ref={ref} className="palette" onCancel={(e) => (e.preventDefault(), setOpen(false))} onClick={(e) => e.target === ref.current && setOpen(false)} aria-label="Поиск">
        {open && (
          <div className="palette__panel">
            <div className="palette__field">
              <Icon name="search" />
              <input
                ref={input}
                className="palette__input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder={role === 'student' ? 'Термин, тема, лекция, тест…' : 'Термин, тема, лекция, группа, учащийся…'}
                aria-label="Что найти"
                aria-controls="palette-list"
                aria-activedescendant={rows[active] ? `pal-${active}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              {loading && <span className="palette__spin" aria-label="Поиск…" />}
              <button type="button" className="palette__esc" onClick={() => setOpen(false)}>
                Esc
              </button>
            </div>
            <div className="palette__list" id="palette-list" role="listbox" ref={list}>
              {!words.length && recent.length > 0 && (
                <div className="palette__recent">
                  <span className="palette__group">Недавние запросы</span>
                  <div className="palette__chips">
                    {recent.map((r) => (
                      <button key={r} type="button" className="chip" onClick={() => setQ(r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {rows.map((r, n) => {
                i += 1;
                const head = n === 0 || rows[n - 1]!.kind !== r.kind;
                const idx = i;
                return (
                  <Fragment key={r.key}>
                    {head && <p className="palette__group">{KIND[r.kind].label}</p>}
                    <button
                      type="button"
                      id={`pal-${idx}`}
                      data-i={idx}
                      role="option"
                      aria-selected={idx === active}
                      className={`palette__item ${idx === active ? 'is-active' : ''}`}
                      onMouseMove={() => setActive(idx)}
                      onClick={() => go(r)}
                    >
                      <span className={`palette__icon palette__icon--${r.kind}`}>
                        <Icon name={r.icon} size={18} />
                      </span>
                      <span className="palette__body">
                        <span className="palette__title">
                          <Hl text={r.title} words={words} />
                        </span>
                        <span className="palette__sub">{r.sub}</span>
                        {r.snippet && (
                          <span className="palette__snippet">
                            <Hl text={r.snippet} words={words} />
                          </span>
                        )}
                      </span>
                      <Icon name="arrow-right" size={16} />
                    </button>
                  </Fragment>
                );
              })}
              {words.length > 0 && !loading && rows.length === 0 && (
                <div className="palette__empty">
                  <p>
                    По запросу «{q.trim()}» ничего не найдено.
                  </p>
                  <p className="muted">Проверьте написание или попробуйте другое слово: например, часть названия темы или термина.</p>
                </div>
              )}
            </div>
            <p className="palette__foot">
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd> выбрать
              </span>
              <span>
                <kbd>Enter</kbd> открыть
              </span>
              <span>
                <kbd>Esc</kbd> закрыть
              </span>
              <span className="palette__count">{words.length ? `найдено: ${hits.length}` : 'регистр и «ё» не важны'}</span>
            </p>
          </div>
        )}
      </dialog>
    </>
  );
};
