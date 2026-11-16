/* каркас: хэдер, боковое меню по роли, основная часть, футер */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { BRAND, ROLE_LABEL, shortName, type Role } from '@pc/core';
import { useApp } from '../lib/app.tsx';
import { itemLink, type ItemKind } from '../lib/format.ts';
import { useLoad } from '../lib/hooks.ts';
import { SearchBox } from '../components/Search.tsx';
import { LiveBanner } from '../pages/live.tsx';
import { Icon, Progress } from '../ui/ui.tsx';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Главная', icon: 'home', roles: ['owner', 'director', 'methodist', 'teacher', 'student'] },
  { to: '/learn', label: 'Мои курсы', icon: 'book', roles: ['student'] },
  { to: '/institutions', label: 'Учреждения', icon: 'building', roles: ['owner'] },
  { to: '/people', label: 'Люди и роли', icon: 'users', roles: ['owner', 'director'] },
  { to: '/structure', label: 'Группы и отделения', icon: 'building', roles: ['owner', 'director', 'methodist', 'teacher'] },
  { to: '/courses', label: 'Курсы', icon: 'book', roles: ['owner', 'director', 'methodist', 'teacher'] },
  { to: '/review', label: 'Проверка работ', icon: 'inbox', roles: ['owner', 'director', 'methodist', 'teacher'] },
  { to: '/progress', label: 'Успеваемость', icon: 'chart', roles: ['owner', 'director', 'methodist', 'teacher'] },
  { to: '/journal', label: 'Журнал успеваемости', icon: 'table', roles: ['owner', 'director', 'methodist', 'teacher'] },
  { to: '/audit', label: 'Журнал действий', icon: 'history', roles: ['owner', 'director'] },
  { to: '/trash', label: 'Корзина', icon: 'trash', roles: ['owner', 'director', 'teacher'] },
];

export const Logo = ({ sub = true }: { sub?: boolean }) => (
  <span className="logo">
    <svg className="logo__mark" viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a72ff" />
          <stop offset="1" stopColor="#6d3cf0" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#logo-bg)" />
      <rect x="25.5" y="8.5" width="7" height="7" rx="1.8" fill="#fff" />
      <rect x="17" y="17" width="7" height="7" rx="1.8" fill="#fff" fillOpacity=".8" />
      <rect x="25.5" y="17" width="7" height="7" rx="1.8" fill="#fff" fillOpacity=".8" />
      <rect x="8.5" y="25.5" width="7" height="7" rx="1.8" fill="#fff" fillOpacity=".6" />
      <rect x="17" y="25.5" width="7" height="7" rx="1.8" fill="#fff" fillOpacity=".6" />
      <rect x="25.5" y="25.5" width="7" height="7" rx="1.8" fill="#fff" fillOpacity=".6" />
    </svg>
    <span className="logo__text">
      <span className="logo__title">{BRAND.name}</span>
      {sub && <span className="logo__sub">{BRAND.tagline}</span>}
    </span>
  </span>
);

/* «Сейчас изучаю»: текущая тема и прогресс курса, нажатие открывает следующий шаг */
const NowLearning = () => {
  const { client } = useApp();
  const loc = useLocation();
  const list = useLoad(
    () => client.call<{ id: string; title: string; progress: { percent: number }; next: { kind: ItemKind; id: string; title: string; module: string } | null }[]>('GET', '/learn/courses'),
    [loc.pathname],
  );
  const c = list.data?.find((x) => x.next) ?? list.data?.[0];
  if (!c) {
    return (
      <p className="now now--empty">
        <span className="now__label">Сейчас изучаю</span>
        <span className="now__title">Курс появится, когда преподаватель назначит его группе</span>
      </p>
    );
  }
  return (
    <Link to={c.next ? itemLink(c.next.kind, c.next.id) : `/learn/${c.id}`} className="now" title={c.next ? `Продолжить: ${c.next.title}` : 'Открыть курс'}>
      <span className="now__label">{c.next ? 'Сейчас изучаю' : 'Курс пройден'}</span>
      <span className="now__title">{c.next ? c.next.module : c.title}</span>
      <span className="now__bar">
        <Progress value={c.progress.percent} label={`Курс пройден на ${c.progress.percent}%`} />
        <span className="now__pct">{c.progress.percent}%</span>
      </span>
    </Link>
  );
};

export const Layout = () => {
  const { user, institution, unread, logout, client } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);

  if (!user) return null;
  const items = NAV.filter((i) => i.roles.includes(user.role));

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Перейти к содержанию
      </a>
      {/* хэдер */}
      <header className="header">
        <button className="icon-btn header__menu" onClick={() => setOpen((v) => !v)} aria-label="Меню" aria-expanded={open} aria-controls="sidebar">
          <Icon name={open ? 'x' : 'menu'} />
        </button>
        <Link to="/" className="header__logo" aria-label="На главную">
          <Logo />
        </Link>
        <SearchBox />
        <nav className="header__tools" aria-label="Пользователь">
          <NavLink to="/notifications" className="icon-btn header__bell" aria-label={`Уведомления${unread ? `: ${unread} новых` : ''}`}>
            <Icon name="bell" />
            {unread > 0 && <span className="header__badge">{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
          <NavLink to="/profile" className="header__user">
            <span className="header__avatar" aria-hidden="true">
              {user.lastName[0]}
              {user.firstName[0]}
            </span>
            <span className="header__who">
              <span className="header__name">{shortName(user)}</span>
              <span className="header__role">{ROLE_LABEL[user.role]}</span>
            </span>
          </NavLink>
          <button
            className="icon-btn"
            aria-label="Выйти"
            title="Выйти"
            onClick={async () => {
              await logout();
              nav('/login');
            }}
          >
            <Icon name="logout" />
          </button>
        </nav>
      </header>

      {/* меню */}
      <aside id="sidebar" className="sidebar" data-open={open}>
        <nav aria-label="Разделы">
          {user.role === 'student' ? (
            <NowLearning />
          ) : (
            institution && (
              <p className="sidebar__inst" title={institution.name}>
                <Icon name="building" size={18} />
                <span className="sidebar__inst-text">
                  <small>Учебное пространство</small>
                  <span>{institution.shortName}</span>
                </span>
              </p>
            )
          )}
          <ul className="nav">
            {items.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} end={i.to === '/'} className="nav__link">
                  <Icon name={i.icon} />
                  <span>{i.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          <ul className="nav nav--secondary">
            <li>
              <NavLink to="/notifications" className="nav__link">
                <Icon name="bell" />
                <span>Уведомления</span>
                {unread > 0 && <span className="nav__count">{unread}</span>}
              </NavLink>
            </li>
            <li>
              <NavLink to="/profile" className="nav__link">
                <Icon name="user" />
                <span>Профиль и настройки</span>
              </NavLink>
            </li>
            <li>
              <NavLink to="/about" className="nav__link">
                <Icon name="info" />
                <span>О платформе</span>
              </NavLink>
            </li>
          </ul>
        </nav>
      </aside>
      <div className="sidebar__overlay" data-open={open} onClick={() => setOpen(false)} aria-hidden="true" />

      {/* основная часть */}
      <main id="main" className="main" tabIndex={-1}>
        <div className="main__inner">
          <LiveBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
};
