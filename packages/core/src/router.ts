/* таблица маршрутов API: одна для сервера и для автономного режима */
import type { Ctx } from './context.ts';
import { notFound, unauthorized } from './errors.ts';
import type { User } from './model.ts';
import type { Ports } from './ports.ts';
import * as auth from './services/auth.ts';
import * as content from './services/content.ts';
import * as learn from './services/learn.ts';
import * as telegram from './services/telegram.ts';
import * as misc from './services/misc.ts';
import * as org from './services/org.ts';
import * as progress from './services/progress.ts';
import * as search from './services/search.ts';
import * as stats from './services/stats.ts';
import * as live from './services/live.ts';

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface Req {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
  token: string | null;
}

type Handler = (ctx: Ctx, req: Req) => Promise<unknown>;

interface Route {
  method: Method;
  path: string;
  public: boolean;
  handler: Handler;
  re: RegExp;
  keys: string[];
}

const routes: Route[] = [];

const add = (method: Method, path: string, handler: Handler, isPublic = false) => {
  const keys: string[] = [];
  const re = new RegExp(
    '^' + path.replace(/:([a-zA-Z]+)/g, (_, k: string) => (keys.push(k), '([^/]+)')) + '$',
  );
  routes.push({ method, path, public: isPublic, handler, re, keys });
};

const p = (req: Req, key: string) => req.params[key] ?? '';

/* вход */
add('POST', '/auth/login', (c, r) => auth.login(c, r.body), true);
add('POST', '/auth/logout', (c, r) => auth.logout(c, r.token), true);
add('POST', '/auth/join', (c, r) => auth.joinGroup(c, r.body), true);
add('GET', '/auth/me', (c) => auth.me(c));
add('POST', '/auth/password', (c, r) => auth.changePassword(c, r.body));

/* сводка */
add('GET', '/dashboard', (c) => misc.dashboard(c));

/* учреждение */
add('GET', '/institutions', (c) => org.listInstitutions(c));
add('POST', '/institutions', (c, r) => org.createInstitution(c, r.body));
add('PATCH', '/institutions/:id', (c, r) => org.updateInstitution(c, p(r, 'id'), r.body));
add('DELETE', '/institutions/:id', (c, r) => org.removeInstitution(c, p(r, 'id')));

add('GET', '/users', (c, r) => org.listUsers(c, r.query));
add('POST', '/users', (c, r) => org.createUser(c, r.body));
add('PATCH', '/users/:id', (c, r) => org.updateUser(c, p(r, 'id'), r.body));
add('DELETE', '/users/:id', (c, r) => org.removeUser(c, p(r, 'id')));
add('POST', '/users/:id/reset-password', (c, r) => org.resetPassword(c, p(r, 'id')));

add('GET', '/departments', (c, r) => org.listDepartments(c, r.query));
add('POST', '/departments', (c, r) => org.createDepartment(c, r.body));
add('PATCH', '/departments/:id', (c, r) => org.updateDepartment(c, p(r, 'id'), r.body));
add('DELETE', '/departments/:id', (c, r) => org.removeDepartment(c, p(r, 'id')));

add('GET', '/groups', (c, r) => org.listGroups(c, r.query));
add('POST', '/groups', (c, r) => org.createGroup(c, r.body));
add('GET', '/groups/:id', (c, r) => org.getGroup(c, p(r, 'id')));
add('PATCH', '/groups/:id', (c, r) => org.updateGroup(c, p(r, 'id'), r.body));
add('DELETE', '/groups/:id', (c, r) => org.removeGroup(c, p(r, 'id')));
add('POST', '/groups/:id/students', (c, r) => org.addStudents(c, p(r, 'id'), r.body));
add('DELETE', '/groups/:id/students/:studentId', (c, r) => org.removeStudent(c, p(r, 'id'), p(r, 'studentId')));
add('POST', '/groups/:id/code', (c, r) => org.regenerateCode(c, p(r, 'id')));

add('GET', '/disciplines', (c, r) => org.listDisciplines(c, r.query));
add('POST', '/disciplines', (c, r) => org.createDiscipline(c, r.body));
add('PATCH', '/disciplines/:id', (c, r) => org.updateDiscipline(c, p(r, 'id'), r.body));
add('DELETE', '/disciplines/:id', (c, r) => org.removeDiscipline(c, p(r, 'id')));

/* контент */
add('GET', '/courses', (c, r) => content.listCourses(c, r.query));
add('POST', '/courses', (c, r) => content.createCourse(c, r.body));
add('GET', '/courses/:id', (c, r) => content.getCourse(c, p(r, 'id')));
add('PATCH', '/courses/:id', (c, r) => content.updateCourse(c, p(r, 'id'), r.body));
add('DELETE', '/courses/:id', (c, r) => content.removeCourse(c, p(r, 'id')));
add('POST', '/courses/:id/status', (c, r) => content.setCourseStatus(c, p(r, 'id'), r.body));
add('POST', '/courses/:id/duplicate', (c, r) => content.duplicateCourse(c, p(r, 'id')));
add('POST', '/courses/:id/sections', (c, r) => content.createSection(c, p(r, 'id'), r.body));

add('PATCH', '/sections/:id', (c, r) => content.updateSection(c, p(r, 'id'), r.body));
add('DELETE', '/sections/:id', (c, r) => content.removeSection(c, p(r, 'id')));
add('POST', '/sections/:id/move', (c, r) => content.moveSection(c, p(r, 'id'), r.body));
add('POST', '/sections/:id/modules', (c, r) => content.createModule(c, p(r, 'id'), r.body));

add('GET', '/modules/:id', (c, r) => content.getModule(c, p(r, 'id')));
add('PATCH', '/modules/:id', (c, r) => content.updateModule(c, p(r, 'id'), r.body));
add('DELETE', '/modules/:id', (c, r) => content.removeModule(c, p(r, 'id')));
add('POST', '/modules/:id/move', (c, r) => content.moveModule(c, p(r, 'id'), r.body));

for (const kind of ['lectures', 'tests', 'labs'] as const) {
  add('POST', `/modules/:id/${kind}`, (c, r) => content.createItem(c, kind, p(r, 'id'), r.body));
  add('GET', `/${kind}/:id`, (c, r) => content.getItem(c, kind, p(r, 'id')));
  add('PATCH', `/${kind}/:id`, (c, r) => content.updateItem(c, kind, p(r, 'id'), r.body));
  add('DELETE', `/${kind}/:id`, (c, r) => content.removeItem(c, kind, p(r, 'id')));
  add('POST', `/${kind}/:id/move`, (c, r) => content.moveItem(c, kind, p(r, 'id'), r.body));
}

/* обучение */
add('GET', '/assignments', (c, r) => learn.listAssignments(c, r.query));
add('POST', '/assignments', (c, r) => learn.createAssignment(c, r.body));
add('PATCH', '/assignments/:id', (c, r) => learn.updateAssignment(c, p(r, 'id'), r.body));
add('DELETE', '/assignments/:id', (c, r) => learn.removeAssignment(c, p(r, 'id')));

add('GET', '/learn/courses', (c) => learn.myCourses(c));
add('GET', '/learn/courses/:id', (c, r) => learn.learnCourse(c, p(r, 'id')));
add('GET', '/learn/lectures/:id', (c, r) => learn.learnLecture(c, p(r, 'id')));
add('POST', '/learn/lectures/:id/view', (c, r) => learn.markViewed(c, p(r, 'id')));
add('GET', '/learn/tests/:id', (c, r) => learn.learnTest(c, p(r, 'id')));
add('POST', '/learn/tests/:id/attempts', (c, r) => learn.submitAttempt(c, p(r, 'id'), r.body));
add('GET', '/learn/labs/:id', (c, r) => learn.learnLab(c, p(r, 'id')));
add('POST', '/learn/labs/:id/submissions', (c, r) => learn.submitLab(c, p(r, 'id'), r.body));
add('POST', '/learn/labs/:id/check', (c, r) => learn.checkLabDiagram(c, p(r, 'id'), r.body));

add('GET', '/submissions', (c, r) => learn.listSubmissions(c, r.query));
add('GET', '/submissions/:id', (c, r) => learn.getSubmission(c, p(r, 'id')));
add('POST', '/submissions/:id/grade', (c, r) => learn.gradeSubmission(c, p(r, 'id'), r.body));
add('POST', '/submissions/:id/return', (c, r) => learn.returnSubmission(c, p(r, 'id'), r.body));
add('GET', '/journal', (c, r) => learn.journal(c, r.query));
add('GET', '/learn/courses/:id/glossary', (c, r) => search.courseGlossary(c, p(r, 'id')));
add('GET', '/tests/:id/stats', (c, r) => stats.testStats(c, p(r, 'id'), r.query));
add('GET', '/search', (c, r) => search.search(c, r.query));

/* опрос на занятии */
add('POST', '/live', (c, r) => live.startLive(c, r.body));
add('GET', '/live/active', (c) => live.activeLive(c));
add('GET', '/live/:id', (c, r) => live.getLive(c, p(r, 'id')));
add('POST', '/live/:id/join', (c, r) => live.joinLive(c, p(r, 'id')));
add('POST', '/live/:id/answer', (c, r) => live.answerLive(c, p(r, 'id'), r.body));
add('POST', '/live/:id/control', (c, r) => live.controlLive(c, p(r, 'id'), r.body));

add('GET', '/progress', (c) => progress.groupsProgress(c));
add('GET', '/progress/:id', (c, r) => progress.groupProgress(c, p(r, 'id')));
add('POST', '/progress/:id/remind', (c, r) => progress.remindDebtors(c, p(r, 'id')));

/* сервисы */
add('GET', '/notifications', (c) => misc.listNotifications(c));
add('GET', '/telegram', (c) => telegram.telegramStatus(c));
add('POST', '/telegram/link', (c) => telegram.telegramLink(c));
add('POST', '/telegram/unlink', (c) => telegram.telegramUnlink(c));
add('POST', '/notifications/read-all', (c) => misc.readAllNotifications(c));
add('POST', '/notifications/:id/read', (c, r) => misc.readNotification(c, p(r, 'id')));
add('GET', '/audit', (c, r) => misc.listAudit(c, r.query));
add('GET', '/trash', (c) => misc.listTrash(c));
add('POST', '/trash/:table/:id/restore', (c, r) => misc.restoreTrash(c, p(r, 'table'), p(r, 'id')));
add('DELETE', '/trash/:table/:id', (c, r) => misc.purgeTrash(c, p(r, 'table'), p(r, 'id')));
add('DELETE', '/files/:id', (c, r) => misc.removeFile(c, p(r, 'id')));

export const match = (method: Method, path: string) => {
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = path.match(route.re);
    if (m) {
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
      return { route, params };
    }
  }
  return null;
};

/* выполнение запроса: и сервер, и автономный режим вызывают именно эту функцию */
export const dispatch = async (
  ports: Ports,
  method: Method,
  path: string,
  req: Omit<Req, 'params'>,
  ip = 'local',
): Promise<unknown> => {
  const found = match(method, path);
  if (!found) throw notFound('Адрес API');
  const user: User | null = await auth.resolveSession(ports, req.token);
  if (!found.route.public && !user) throw unauthorized();
  const ctx: Ctx = { ...ports, user, ip };
  return found.route.handler(ctx, { ...req, params: found.params });
};

export const routeList = () => routes.map((r) => `${r.method} ${r.path}`);
