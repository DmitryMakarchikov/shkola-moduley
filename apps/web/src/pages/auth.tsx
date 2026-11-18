/* вход и присоединение к группе по коду */
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_LABEL } from '@pc/core';
import { AuthBackdrop } from '../components/AuthBackdrop.tsx';
import { Logo } from '../layout/Layout.tsx';
import { useApp } from '../lib/app.tsx';
import { Button, ErrorBox, Field, Icon } from '../ui/ui.tsx';

const POINTS = [
  { icon: 'book', title: 'Курсы из модулей', text: 'В каждом модуле — лекции, тесты и лабораторные работы' },
  { icon: 'user', title: 'Свой вариант у каждого', text: 'Задания тестов и варианты работ выдаются индивидуально' },
  { icon: 'check', title: 'Проверка и отметки', text: 'Сдача работ с файлами, диаграммы с автопроверкой, журнал' },
  { icon: 'cycle', title: 'Везде', text: 'Компьютер, планшет, телефон — с сервера и без интернета' },
];

const AuthShell = ({ children, title, lead }: { children: React.ReactNode; title: string; lead: string }) => (
  <div className="auth">
    {/* форма */}
    <section className="auth__card" aria-labelledby="auth-title">
      <div className="auth__inner">
        <Logo />
        <div>
          <h1 id="auth-title" className="auth__title">
            {title}
          </h1>
          <p className="auth__sub">{lead}</p>
        </div>
        {children}
      </div>
    </section>
    {/* о платформе; на фоне — схемы из технологии разработки ПО */}
    <aside className="auth__aside">
      <AuthBackdrop />
      <div className="auth__art">
        <p className="auth__lead">Учебные курсы из модулей — шаг за шагом</p>
        <ul className="auth__points">
          {POINTS.map((p) => (
            <li key={p.title} className="auth__point">
              <span className="auth__point-icon">
                <Icon name={p.icon} />
              </span>
              <span>
                <strong>{p.title}</strong>
                <span>{p.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  </div>
);

export const LoginPage = () => {
  const { user, login } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [lg, setLg] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (loc.state as { from?: string } | null)?.from ?? '/';

  if (user) return <Navigate to={from} replace />;

  const submit = async (e?: FormEvent, l = lg, p = pw) => {
    e?.preventDefault();
    if (!l.trim() || !p) {
      setError('Введите логин и пароль');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(l.trim(), p);
      nav(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Вход" lead="Введите логин и пароль, которые выдал администратор учреждения.">
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Логин">{(id) => <input id={id} className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={lg} onChange={(e) => setLg(e.target.value)} />}</Field>
        <Field label="Пароль">
          {(id) => (
            <span className="input-group">
              <input id={id} className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button type="button" className="input-group__btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={show}>
                <Icon name="eye" size={18} />
              </button>
            </span>
          )}
        </Field>
        {error && <ErrorBox text={error} />}
        <Button kind="primary" type="submit" busy={busy} className="btn--block btn--lg">
          Войти
        </Button>
      </form>

      {/* регистрация по коду группы */}
      <Link to="/join" className="hint-card">
        <span className="hint-card__icon">
          <Icon name="key" />
        </span>
        <span className="hint-card__text">
          <strong>Есть код группы от куратора?</strong>
          <span>Создайте учётную запись учащегося — это займёт минуту</span>
        </span>
        <span className="hint-card__arrow" aria-hidden="true">
          <Icon name="arrow-right" />
        </span>
      </Link>

      {/* демонстрация */}
      <section className="demo" aria-labelledby="demo-title">
        <h2 id="demo-title" className="demo__title">
          Быстрый вход для знакомства <span className="demo__pw">пароль {DEMO_PASSWORD}</span>
        </h2>
        <div className="demo__list">
          {DEMO_ACCOUNTS.map((a) => (
            <button key={a.login} className="demo__item" type="button" disabled={busy} onClick={() => void submit(undefined, a.login, DEMO_PASSWORD)}>
              <span className={`demo__avatar demo__avatar--${a.role}`} aria-hidden="true">
                {a.name.split(' ').slice(0, 2).map((x) => x[0]).join('')}
              </span>
              <span className="demo__who">
                <span className="demo__role">{ROLE_LABEL[a.role]}</span>
                <span className="demo__name">{a.name.split(' ').slice(0, 2).join(' ')}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </AuthShell>
  );
};

export const JoinPage = () => {
  const { user, join } = useApp();
  const nav = useNavigate();
  const [form, setForm] = useState({ code: '', lastName: '', firstName: '', middleName: '', login: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthShell title="Регистрация учащегося" lead="Код группы выдаёт куратор. После регистрации вы сразу попадёте в свою группу и увидите курсы.">
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await join(form);
            nav('/');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Код группы" hint="8 букв и цифр, например K7MQ-2PXR">
          {(id) => <input id={id} className="input input--code" autoCapitalize="characters" spellCheck={false} value={form.code} onChange={set('code')} required />}
        </Field>
        <div className="form__row">
          <Field label="Фамилия">{(id) => <input id={id} className="input" autoComplete="family-name" value={form.lastName} onChange={set('lastName')} required />}</Field>
          <Field label="Имя">{(id) => <input id={id} className="input" autoComplete="given-name" value={form.firstName} onChange={set('firstName')} required />}</Field>
        </div>
        <Field label="Отчество (если есть)">{(id) => <input id={id} className="input" autoComplete="additional-name" value={form.middleName} onChange={set('middleName')} />}</Field>
        <div className="form__row">
          <Field label="Логин" hint="Латинские буквы и цифры">
            {(id) => <input id={id} className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={form.login} onChange={set('login')} required />}
          </Field>
          <Field label="Пароль" hint="От 8 символов, буквы и цифры">
            {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required />}
          </Field>
        </div>
        {error && <ErrorBox text={error} />}
        <Button kind="primary" type="submit" busy={busy} className="btn--block btn--lg">
          Зарегистрироваться
        </Button>
      </form>
      <Link to="/login" className="auth__back">
        <Icon name="arrow-left" size={16} /> У меня уже есть логин и пароль
      </Link>
    </AuthShell>
  );
};
