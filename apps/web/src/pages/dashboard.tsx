/* главная: у учащегося — что делать дальше, у сотрудников — сводка и быстрые действия */
import { useState } from 'react';
import { Link } from 'react-router';
import { ROLE_LABEL, type Role } from '@pc/core';
import { useApp } from '../lib/app.tsx';
import { fmtDateTime, itemLink, KIND_ICON, plural, SUB_STATUS, type ItemKind } from '../lib/format.ts';
import { useLoad } from '../lib/hooks.ts';
import { Async, Badge, DueBadge, Empty, Icon, PageHead, Progress, Stairs, Stat } from '../ui/ui.tsx';
import { DistBar, gradeTone, Ring, type GroupSum } from './progress.tsx';

interface Step {
  kind: ItemKind;
  id: string;
  title: string;
  module: string;
}

interface StudentDash {
  role: 'student';
  courses: { id: string; title: string; progress: { percent: number }; next: Step | null; steps: { title: string; done: number; total: number }[] }[];
  todo: (Step & { course: string; due: string | null; status: string | null; overdue: boolean })[];
  waiting: { id: string; title: string; course: string }[];
  grades: { id: string; title: string; course: string; grade: number }[];
  tests: { id: string; title: string; course: string; best: number; passed: boolean }[];
  total: { lectures: number; lecturesDone: number; tests: number; testsDone: number; labs: number; labsDone: number };
  average: number | null;
}

interface StaffDash {
  role: string;
  users: Record<string, number>;
  groups: number;
  courses: Record<string, number>;
  pending: number;
  pendingList: { id: string; studentName: string; labTitle: string; groupName: string; createdAt: string; late: boolean }[];
  review?: { id: string; title: string }[];
  institutions?: number;
  myCourses?: number;
  myDrafts?: number;
}

/* «С чего начать»: короткая дорожка знакомства для каждой роли; скрывается и запоминается в браузере */
interface GuideStep {
  icon: string;
  title: string;
  text: string;
  to?: string;
  search?: boolean;
}

const guideSteps = (role: Role, course?: StudentDash['courses'][number], lab?: string): GuideStep[] => {
  if (role === 'student') {
    const c = course;
    return [
      { icon: 'lecture', title: 'Модуль по шагам', text: 'Лекция разбита на короткие шаги, после шага — проверка терминов', to: c ? (c.next ? itemLink(c.next.kind, c.next.id) : `/learn/${c.id}`) : '/learn' },
      { icon: 'eye', title: 'Интерактивные схемы', text: 'Нажимайте на номера на схеме: деталь приближается, рядом пояснение', to: c ? `/learn/${c.id}` : '/learn' },
      { icon: 'search', title: 'Поиск по курсу', text: 'Ctrl+K или «/»: термин, тема, лекция — с подсветкой в тексте', search: true },
      { icon: 'glossary', title: 'Словарь терминов', text: 'Все термины курса по алфавиту, карточки и тренажёр', to: c ? `/learn/${c.id}/glossary` : '/learn' },
      { icon: 'lab', title: 'Конструктор UML', text: 'Диаграмма проверяется сразу, ещё до сдачи работы', to: lab ? itemLink('lab', lab) : c ? `/learn/${c.id}` : '/learn' },
    ];
  }
  if (role === 'teacher') {
    return [
      { icon: 'book', title: 'Курс из модулей', text: 'Лекции из блоков, тесты, лабораторные; на рисунке — точки-подсказки', to: '/courses' },
      { icon: 'inbox', title: 'Проверка работ', text: 'Очередь сданных работ, отметка и готовые замечания', to: '/review' },
      { icon: 'chart', title: 'Успеваемость группы', text: 'Должники и зона риска, напоминание одной кнопкой', to: '/progress' },
      { icon: 'test', title: 'Анализ заданий и опрос', text: 'На странице теста: что усвоено и опрос на занятии', to: '/courses' },
      { icon: 'package', title: 'Модуль без платформы', text: 'На странице модуля: пакет HTML5 / SCORM для СДО', to: '/courses' },
    ];
  }
  if (role === 'methodist') {
    return [
      { icon: 'book', title: 'Утверждение курсов', text: 'Курсы на проверке: утвердить или вернуть с замечанием', to: '/courses' },
      { icon: 'chart', title: 'Успеваемость групп', text: 'Сравнение групп учреждения, долги и зона риска', to: '/progress' },
      { icon: 'table', title: 'Журнал успеваемости', text: 'Отметки по группам и курсам с выгрузкой в Excel', to: '/journal' },
      { icon: 'test', title: 'Анализ заданий', text: 'На странице теста: какие задания стоит переписать', to: '/courses' },
    ];
  }
  return [
    { icon: 'users', title: 'Люди и роли', text: 'Учётные записи сотрудников и учащихся, сброс пароля', to: '/people' },
    { icon: 'building', title: 'Группы и отделения', text: 'Кураторы, коды приглашения в группу', to: '/structure' },
    { icon: 'chart', title: 'Успеваемость групп', text: 'Сравнение групп, долги и зона риска', to: '/progress' },
    { icon: 'history', title: 'Журнал действий', text: 'Кто и что изменил в учреждении', to: '/audit' },
  ];
};

const StartGuide = ({ role, course, lab }: { role: Role; course?: StudentDash['courses'][number]; lab?: string }) => {
  const key = `pc.guide.${role}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === 'hidden';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const steps = guideSteps(role, course, lab);
  return (
    <section className="guide card" aria-labelledby="guide-title">
      <div className="guide__head">
        <div>
          <h2 id="guide-title" className="card__title">
            С чего начать
          </h2>
          <p className="muted small">{steps.length} шагов, чтобы познакомиться с платформой</p>
        </div>
        <button
          type="button"
          className="guide__hide"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(key, 'hidden');
            } catch {
              /* хранилище недоступно */
            }
          }}
        >
          Скрыть
        </button>
      </div>
      <ol className="guide__list">
        {steps.map((s, i) => {
          const body = (
            <>
              <span className="guide__n">{i + 1}</span>
              <span className="guide__icon">
                <Icon name={s.icon} size={18} />
              </span>
              <span className="guide__title">{s.title}</span>
              <span className="guide__text">{s.text}</span>
            </>
          );
          return (
            <li key={s.title}>
              {s.search ? (
                <button type="button" className="guide__item" onClick={() => dispatchEvent(new Event('pc:search'))}>
                  {body}
                </button>
              ) : (
                <Link to={s.to!} className="guide__item">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
};

export const DashboardPage = () => {
  const { client, user } = useApp();
  const state = useLoad(() => client.call<StudentDash | StaffDash>('GET', '/dashboard'), []);
  if (!user) return null;

  return (
    <>
      <PageHead kicker={ROLE_LABEL[user.role]} title={`${greeting()}, ${user.firstName}!`} />
      <Async state={state}>
        {(d) =>
          d.role === 'student' ? (
            <>
              <StartGuide role="student" course={(d as StudentDash).courses[0]} lab={(d as StudentDash).todo.find((t) => t.kind === 'lab')?.id} />
              <StudentHome d={d as StudentDash} />
            </>
          ) : (
            <>
              <StartGuide role={user.role} />
              <StaffHome d={d as StaffDash} role={user.role} />
            </>
          )
        }
      </Async>
    </>
  );
};

/* ---------- учащийся ---------- */
const StudentHome = ({ d }: { d: StudentDash }) => {
  if (d.courses.length === 0) {
    return (
      <section className="card">
        <Empty title="Курсов пока нет" text="Когда преподаватель назначит курс вашей группе, он появится здесь. Если вы ещё не в группе — попросите у куратора код группы." />
      </section>
    );
  }
  const t = d.total;
  return (
    <>
      {/* продолжить */}
      {d.courses.map((c) => (
        <section key={c.id} className={`hero ${c.next ? '' : 'hero--done'}`} aria-label={`Курс ${c.title}`}>
          <div className="hero__main">
            <p className="hero__kicker">{c.next ? 'Продолжить обучение' : 'Курс пройден'}</p>
            <h2 className="hero__title">{c.title}</h2>
            <p className="hero__next">
              {c.next ? (
                <>
                  Следующий шаг: <strong>{c.next.title}</strong>
                </>
              ) : (
                'Все лекции прочитаны, тесты сданы, лабораторные оценены.'
              )}
            </p>
            <Link to={c.next ? itemLink(c.next.kind, c.next.id) : `/learn/${c.id}`} className="btn hero__btn">
              <span>{c.next ? 'Продолжить' : 'Открыть курс'}</span>
              <Icon name="arrow-right" size={18} />
            </Link>
          </div>
          <div className="hero__stairs">
            <Stairs steps={c.steps} />
            <p className="hero__percent">
              <strong>{c.progress.percent}%</strong> пройдено
            </p>
          </div>
        </section>
      ))}

      {/* показатели */}
      <div className="mini-stats">
        <Mini icon="lecture" label="Лекции прочитаны" done={t.lecturesDone} all={t.lectures} />
        <Mini icon="test" label="Тесты сданы" done={t.testsDone} all={t.tests} />
        <Mini icon="lab" label="Лабораторные оценены" done={t.labsDone} all={t.labs} />
        <div className="mini">
          <span className="mini__label">
            <Icon name="check" size={18} /> Средняя отметка
          </span>
          <span className="mini__value">{d.average ?? '—'}</span>
        </div>
      </div>

      <div className="grid grid--2">
        {/* что сделать */}
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Что нужно сделать</h2>
            <Link to="/learn" className="link">
              Все курсы
            </Link>
          </div>
          {d.todo.length === 0 ? (
            <Empty title="Всё сдано" text="Новых заданий нет. Можно повторить лекции или пройти тесты ещё раз." />
          ) : (
            <ul className="todo">
              {d.todo.map((x) => (
                <li key={x.id} className="todo__item">
                  <Link to={itemLink(x.kind, x.id)} className="todo__link">
                    <span className={`todo__icon todo__icon--${x.kind}`}>
                      <Icon name={KIND_ICON[x.kind]} />
                    </span>
                    <span className="todo__body">
                      <span className="todo__title">{x.title}</span>
                      <span className="todo__meta">Модуль: {x.module}</span>
                    </span>
                    <span className="todo__side">
                      {x.status === 'returned' && <Badge tone="err">вернули на доработку</Badge>}
                      <DueBadge due={x.due} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {d.waiting.length > 0 && (
            <p className="muted">
              На проверке у преподавателя: {d.waiting.length} {plural(d.waiting.length, ['работа', 'работы', 'работ'])}.
            </p>
          )}
        </section>

        {/* отметки */}
        <section className="card">
          <h2 className="card__title">Мои результаты</h2>
          {d.grades.length === 0 && d.tests.length === 0 ? (
            <Empty title="Пока пусто" text="Здесь появятся отметки за лабораторные работы и результаты тестов." />
          ) : (
            <ul className="marks">
              {d.grades.map((g) => (
                <li key={g.id} className="marks__item">
                  <span className={`grade ${g.grade < 4 ? 'grade--low' : ''}`}>{g.grade}</span>
                  <Link to={itemLink('lab', g.id)} className="marks__body link-plain">
                    <span className="marks__title">{g.title}</span>
                    <span className="marks__meta">Лабораторная работа · отметка из 10</span>
                  </Link>
                </li>
              ))}
              {d.tests.map((x) => (
                <li key={x.id} className="marks__item">
                  <span className={`grade ${x.passed ? '' : 'grade--low'}`}>{x.best}%</span>
                  <Link to={itemLink('test', x.id)} className="marks__body link-plain">
                    <span className="marks__title">{x.title}</span>
                    <span className="marks__meta">Тест · {x.passed ? 'сдан' : 'не сдан, можно пройти ещё раз'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
};

const Mini = ({ icon, label, done, all }: { icon: string; label: string; done: number; all: number }) => (
  <div className="mini">
    <span className="mini__label">
      <Icon name={icon} size={18} /> {label}
    </span>
    <span className="mini__value">
      {done} <small>из {all}</small>
    </span>
    <Progress value={all ? (done / all) * 100 : 0} label={label} />
  </div>
);

/* ---------- сотрудники ---------- */
const QUICK: { to: string; icon: string; title: string; text: string; roles: Role[] }[] = [
  { to: '/review', icon: 'inbox', title: 'Проверить работы', text: 'Сданные лабораторные', roles: ['owner', 'director', 'methodist', 'teacher'] },
  { to: '/courses', icon: 'book', title: 'Курсы', text: 'Модули, лекции, тесты, лабораторные', roles: ['owner', 'director', 'methodist', 'teacher'] },
  { to: '/journal', icon: 'table', title: 'Журнал', text: 'Успеваемость группы', roles: ['owner', 'director', 'methodist', 'teacher'] },
  { to: '/people', icon: 'users', title: 'Люди и роли', text: 'Добавить, заблокировать, сменить роль', roles: ['owner', 'director'] },
  { to: '/structure', icon: 'building', title: 'Группы', text: 'Учащиеся, кураторы, коды', roles: ['owner', 'director', 'methodist', 'teacher'] },
];

const StaffHome = ({ d, role }: { d: StaffDash; role: Role }) => (
  <>
    <nav className="quick" aria-label="Быстрые действия">
      {QUICK.filter((q) => q.roles.includes(role)).map((q) => (
        <Link key={q.to} to={q.to} className="quick__item">
          <span className="quick__icon">
            <Icon name={q.icon} />
          </span>
          <span className="quick__text">
            <strong>
              {q.title} {q.to === '/review' && d.pending > 0 && <Badge tone="warn">{d.pending}</Badge>}
            </strong>
            <span>{q.text}</span>
          </span>
        </Link>
      ))}
    </nav>

    <div className="stats">
      {role === 'owner' && <Stat value={d.institutions ?? 0} label="Учреждений" />}
      <Stat value={d.users.student ?? 0} label="Учащихся" />
      <Stat value={d.users.teacher ?? 0} label="Преподавателей" />
      <Stat value={d.groups} label="Учебных групп" />
      <Stat value={d.courses.published ?? 0} label="Опубликованных курсов" tone="ok" />
      {role === 'teacher' && <Stat value={d.myCourses ?? 0} label="Моих курсов" />}
    </div>

    <GroupsGlance role={role} />

    <div className="grid grid--2">
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Ждут проверки</h2>
          <Link to="/review" className="link">
            Все работы
          </Link>
        </div>
        {d.pendingList.length === 0 ? (
          <Empty title="Все работы проверены" text="Новые сданные работы появятся здесь." />
        ) : (
          <ul className="todo">
            {d.pendingList.map((s) => (
              <li key={s.id} className="todo__item">
                <Link to={`/review/${s.id}`} className="todo__link">
                  <span className="todo__icon todo__icon--lab">
                    <Icon name="lab" />
                  </span>
                  <span className="todo__body">
                    <span className="todo__title">{s.studentName}</span>
                    <span className="todo__meta">
                      {s.labTitle} · {s.groupName}
                    </span>
                  </span>
                  <span className="todo__side">
                    {s.late && <Badge tone="err">после срока</Badge>}
                    <span className="muted">{fmtDateTime(s.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2 className="card__title">Курсы учреждения</h2>
        <div className="stats stats--compact">
          <Stat value={d.courses.draft ?? 0} label="Черновики" />
          <Stat value={d.courses.review ?? 0} label="На утверждении" tone={d.courses.review ? 'warn' : undefined} />
          <Stat value={d.courses.published ?? 0} label="Опубликованы" tone="ok" />
          <Stat value={d.courses.archived ?? 0} label="В архиве" />
        </div>
        {d.review && d.review.length > 0 && (
          <>
            <h3 className="card__subtitle">Ждут утверждения</h3>
            <ul className="list">
              {d.review.map((c) => (
                <li key={c.id} className="list__item">
                  <Link to={`/courses/${c.id}`} className="list__link">
                    <span className="list__title">{c.title}</span>
                    <span className="list__meta">{SUB_STATUS.submitted.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  </>
);

/* успеваемость на главной: куратору — своя группа, директору и методисту — сравнение групп */
const GroupsGlance = ({ role }: { role: Role }) => {
  const { client } = useApp();
  const list = useLoad(() => client.call<GroupSum[]>('GET', '/progress'), []);
  const groups = list.data ?? [];
  const mine = groups.filter((g) => g.curated);
  const shown = role === 'teacher' ? mine : groups;
  if (!shown.length) return null;
  const num = (x: number | null) => (x === null ? '—' : String(x).replace('.', ','));
  return (
    <section className="card glance">
      <div className="card__head">
        <h2 className="card__title">{role === 'teacher' ? (mine.length > 1 ? 'Мои группы' : `Моя группа ${mine[0]!.name}`) : 'Успеваемость групп'}</h2>
        <Link to="/progress" className="link">
          Подробно
        </Link>
      </div>
      <div className="glance__list">
        {shown.slice(0, 4).map((g) => (
          <Link key={g.id} to={`/progress/${g.id}`} className="glance__item">
            <Ring value={g.plan} label={`Выполнено в срок: ${g.name}`} />
            <div className="glance__body">
              <strong>{g.name}</strong>
              <span>
                в срок {g.plan}% · средний балл <b className={`tone-${gradeTone(g.average)}`}>{num(g.average)}</b> · долгов <b className={g.debts ? 'tone-err' : ''}>{g.debts}</b> · на проверке <b>{g.pending}</b>
              </span>
              <DistBar d={g.distribution} total={g.students} />
            </div>
            {g.risk > 0 && <Badge tone="err">в зоне риска: {g.risk}</Badge>}
          </Link>
        ))}
      </div>
    </section>
  );
};
