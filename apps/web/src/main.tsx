/* точка входа: выбор режима, маршруты, тема */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Link, Navigate, RouterProvider, useLocation, useRouteError } from 'react-router';
import type { Role } from '@pc/core';
import { createClient } from './api/index.ts';
import { Layout } from './layout/Layout.tsx';
import { AppProvider, useApp } from './lib/app.tsx';
import { applyPrefs } from './lib/hooks.ts';
import { JoinPage, LoginPage } from './pages/auth.tsx';
import { CoursePage, CoursesPage } from './pages/courses.tsx';
import { DashboardPage } from './pages/dashboard.tsx';
import { LabPage, LearnCoursePage, LecturePage, MyCoursesPage, TestPage } from './pages/learn.tsx';
import { ItemEditor, ModulePage } from './pages/module.tsx';
import { PeoplePage } from './pages/people.tsx';
import { JournalPage, ReviewPage, SubmissionPage } from './pages/review.tsx';
import { GroupProgressPage, ProgressPage } from './pages/progress.tsx';
import { GlossaryPage } from './pages/glossary.tsx';
import { LivePage } from './pages/live.tsx';
import { TestStatsPage } from './pages/stats.tsx';
import { AboutPage, AuditPage, NotificationsPage, ProfilePage, TrashPage } from './pages/service.tsx';
import { GroupPage, InstitutionsPage, StructurePage } from './pages/structure.tsx';
import { Empty } from './ui/ui.tsx';
import './styles/main.scss';

const STAFF: Role[] = ['owner', 'director', 'methodist', 'teacher'];

/* доступ только после входа и только своим ролям */
const Guard = ({ roles, children }: { roles?: Role[]; children: React.ReactNode }) => {
  const { user } = useApp();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return <Empty title="Раздел недоступен для вашей роли">{<Link to="/">На главную</Link>}</Empty>;
  }
  return <>{children}</>;
};

const NotFound = () => (
  <Empty title="Страница не найдена" text="Возможно, ссылка устарела или материал перемещён в корзину.">
    <Link to="/">На главную</Link>
  </Empty>
);

/* страница ошибки: вместо технического сообщения — понятные действия */
const ErrorPage = () => {
  const err = useRouteError() as { message?: string } | undefined;
  return (
    <div className="splash">
      <Empty title="Что-то пошло не так" text="Страница не открылась из-за ошибки. Обновите страницу; если ошибка повторится, вернитесь на главную.">
        <div className="actions">
          <button className="btn btn--primary" onClick={() => location.reload()}>
            Обновить страницу
          </button>
          <a className="btn" href="#/" onClick={() => setTimeout(() => location.reload(), 50)}>
            На главную
          </a>
        </div>
        {err?.message && <p className="muted small">Подробности: {err.message}</p>}
      </Empty>
    </div>
  );
};

const only = (roles: Role[], el: React.ReactNode) => <Guard roles={roles}>{el}</Guard>;

const router = createHashRouter([
  { path: '/login', element: <LoginPage />, errorElement: <ErrorPage /> },
  { path: '/join', element: <JoinPage />, errorElement: <ErrorPage /> },
  {
    path: '/',
    errorElement: <ErrorPage />,
    element: (
      <Guard>
        <Layout />
      </Guard>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'institutions', element: only(['owner'], <InstitutionsPage />) },
      { path: 'people', element: only(['owner', 'director'], <PeoplePage />) },
      { path: 'structure', element: only(STAFF, <StructurePage />) },
      { path: 'groups/:id', element: only(STAFF, <GroupPage />) },
      { path: 'courses', element: only(STAFF, <CoursesPage />) },
      { path: 'courses/:id', element: only(STAFF, <CoursePage />) },
      { path: 'modules/:id', element: only(STAFF, <ModulePage />) },
      { path: 'edit/:kind/:id', element: only(STAFF, <ItemEditor />) },
      { path: 'tests/:id/stats', element: only(STAFF, <TestStatsPage />) },
      { path: 'live/:id', element: <LivePage /> },
      { path: 'review', element: only(STAFF, <ReviewPage />) },
      { path: 'review/:id', element: only(STAFF, <SubmissionPage />) },
      { path: 'progress', element: only(STAFF, <ProgressPage />) },
      { path: 'progress/:id', element: only(STAFF, <GroupProgressPage />) },
      { path: 'journal', element: only(STAFF, <JournalPage />) },
      { path: 'learn', element: <MyCoursesPage /> },
      { path: 'learn/:courseId', element: <LearnCoursePage /> },
      { path: 'learn/:courseId/glossary', element: <GlossaryPage /> },
      { path: 'learn/lecture/:id', element: <LecturePage /> },
      { path: 'learn/test/:id', element: <TestPage /> },
      { path: 'learn/lab/:id', element: <LabPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'audit', element: only(['owner', 'director'], <AuditPage />) },
      { path: 'trash', element: only(['owner', 'director', 'teacher'], <TrashPage />) },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'about', element: <AboutPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

/* запуск */
applyPrefs();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);

const root = createRoot(document.getElementById('root')!);
createClient()
  .then((client) =>
    root.render(
      <StrictMode>
        <AppProvider client={client}>
          <RouterProvider router={router} />
        </AppProvider>
      </StrictMode>,
    ),
  )
  .catch((e: Error) => root.render(<div className="splash">Не удалось запустить: {e.message}</div>));

/* приложение (PWA): офлайн-кэш, только для http(s) */
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
