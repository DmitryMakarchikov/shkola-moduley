/* схема базы данных PostgreSQL (Drizzle ORM): 20 таблиц, ключи, связи, индексы.
   Миграции создаются командой npm run db:generate и применяются при запуске сервера */
import { sql } from 'drizzle-orm';
import { boolean, check, customType, index, integer, jsonb, pgTable, text, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';

/* время: в базе timestamptz, в приложении строка ISO 8601 */
const iso = (v: unknown) => {
  if (v instanceof Date) return v.toISOString();
  let s = String(v).replace(' ', 'T');
  if (/[+-]\d\d$/.test(s)) s += ':00';
  return new Date(s).toISOString();
};
const ts = customType<{ data: string; driverData: string }>({
  dataType: () => 'timestamp with time zone',
  toDriver: (v) => v,
  fromDriver: (v) => iso(v),
});

/* служебные поля каждой таблицы; удаление мягкое: deleted_at — «в корзине» */
const base = () => ({
  id: text('id').primaryKey(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  deletedAt: ts('deleted_at'),
  deletedBy: text('deleted_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
});

/* ---------- учреждение и люди ---------- */
export const institutions = pgTable('institutions', {
  ...base(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  city: text('city').notNull().default(''),
});

export const departments = pgTable(
  'departments',
  {
    ...base(),
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    name: text('name').notNull(),
  },
  (t) => [index('departments_institution_idx').on(t.institutionId)],
);

export const users = pgTable(
  'users',
  {
    ...base(),
    institutionId: text('institution_id').references(() => institutions.id),
    role: text('role').notNull(),
    login: text('login').notNull(),
    lastName: text('last_name').notNull(),
    firstName: text('first_name').notNull(),
    middleName: text('middle_name').notNull().default(''),
    email: text('email').notNull().default(''),
    passwordHash: text('password_hash').notNull(),
    status: text('status').notNull().default('active'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: ts('last_login_at'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    telegramChatId: text('telegram_chat_id'),
    telegramCode: text('telegram_code'),
    telegramCodeExpires: ts('telegram_code_expires'),
  },
  (t) => [
    uniqueIndex('users_login_uq').on(t.login).where(sql`deleted_at is null`),
    index('users_institution_idx').on(t.institutionId),
    index('users_telegram_chat_idx').on(t.telegramChatId),
    index('users_telegram_code_idx').on(t.telegramCode),
    check('users_role_ck', sql`${t.role} in ('owner', 'director', 'methodist', 'teacher', 'student')`),
    check('users_status_ck', sql`${t.status} in ('active', 'blocked')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    ...base(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const groups = pgTable(
  'groups',
  {
    ...base(),
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    departmentId: text('department_id').references(() => departments.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    year: integer('year').notNull().default(1),
    specialty: text('specialty').notNull().default(''),
    curatorId: text('curator_id').references(() => users.id, { onDelete: 'set null' }),
    joinCode: text('join_code').notNull(),
  },
  (t) => [uniqueIndex('groups_join_code_uq').on(t.joinCode).where(sql`deleted_at is null`), index('groups_institution_idx').on(t.institutionId)],
);

export const groupMembers = pgTable(
  'group_members',
  {
    ...base(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('group_members_uq').on(t.groupId, t.studentId).where(sql`deleted_at is null`), index('group_members_student_idx').on(t.studentId)],
);

/* ---------- учебный контент ---------- */
export const disciplines = pgTable(
  'disciplines',
  {
    ...base(),
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    name: text('name').notNull(),
    code: text('code').notNull().default(''),
  },
  (t) => [index('disciplines_institution_idx').on(t.institutionId)],
);

export const courses = pgTable(
  'courses',
  {
    ...base(),
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    disciplineId: text('discipline_id')
      .notNull()
      .references(() => disciplines.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('draft'),
    reviewComment: text('review_comment').notNull().default(''),
  },
  (t) => [
    index('courses_institution_idx').on(t.institutionId),
    index('courses_author_idx').on(t.authorId),
    check('courses_status_ck', sql`${t.status} in ('draft', 'review', 'published', 'archived')`),
  ],
);

export const sections = pgTable(
  'sections',
  {
    ...base(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull().default(1),
  },
  (t) => [index('sections_course_idx').on(t.courseId)],
);

export const modules = pgTable(
  'modules',
  {
    ...base(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    sectionId: text('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull().default(1),
    goal: text('goal').notNull().default(''),
    tasks: jsonb('tasks').notNull().default([]),
    outcomes: jsonb('outcomes').notNull().default([]),
    hours: integer('hours').notNull().default(2),
  },
  (t) => [index('modules_course_idx').on(t.courseId), index('modules_section_idx').on(t.sectionId)],
);

export const lectures = pgTable(
  'lectures',
  {
    ...base(),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull().default(1),
    blocks: jsonb('blocks').notNull().default([]),
  },
  (t) => [index('lectures_module_idx').on(t.moduleId)],
);

export const tests = pgTable(
  'tests',
  {
    ...base(),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull().default(1),
    settings: jsonb('settings').notNull(),
    questions: jsonb('questions').notNull().default([]),
  },
  (t) => [index('tests_module_idx').on(t.moduleId)],
);

export const labs = pgTable(
  'labs',
  {
    ...base(),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull().default(1),
    goal: text('goal').notNull().default(''),
    description: text('description').notNull().default(''),
    variants: jsonb('variants').notNull().default([]),
    criteria: jsonb('criteria').notNull().default([]),
    templateFileIds: jsonb('template_file_ids').notNull().default([]),
    maxScore: integer('max_score').notNull().default(10),
    allowFiles: boolean('allow_files').notNull().default(true),
    diagramKind: text('diagram_kind'),
    diagramReference: jsonb('diagram_reference'),
    blocks: jsonb('blocks').notNull().default([]),
    controlQuestions: jsonb('control_questions').notNull().default([]),
  },
  (t) => [index('labs_module_idx').on(t.moduleId)],
);

/* ---------- обучение и контроль ---------- */
export const assignments = pgTable(
  'assignments',
  {
    ...base(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => users.id),
    dueDates: jsonb('due_dates').notNull().default({}),
  },
  (t) => [index('assignments_course_idx').on(t.courseId), index('assignments_group_idx').on(t.groupId)],
);

export const submissions = pgTable(
  'submissions',
  {
    ...base(),
    labId: text('lab_id')
      .notNull()
      .references(() => labs.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignmentId: text('assignment_id').references(() => assignments.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    fileIds: jsonb('file_ids').notNull().default([]),
    comment: text('comment').notNull().default(''),
    diagram: jsonb('diagram'),
    autoScore: integer('auto_score'),
    status: text('status').notNull().default('submitted'),
    grade: integer('grade'),
    teacherComment: text('teacher_comment').notNull().default(''),
    gradedBy: text('graded_by').references(() => users.id, { onDelete: 'set null' }),
    gradedAt: ts('graded_at'),
    late: boolean('late').notNull().default(false),
  },
  (t) => [
    index('submissions_lab_student_idx').on(t.labId, t.studentId),
    index('submissions_student_idx').on(t.studentId),
    check('submissions_status_ck', sql`${t.status} in ('submitted', 'returned', 'graded')`),
    check('submissions_grade_ck', sql`${t.grade} is null or ${t.grade} between 1 and 10`),
  ],
);

export const attempts = pgTable(
  'attempts',
  {
    ...base(),
    testId: text('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    answers: jsonb('answers').notNull().default({}),
    score: integer('score').notNull().default(0),
    maxScore: integer('max_score').notNull().default(0),
    percent: integer('percent').notNull().default(0),
    details: jsonb('details').notNull().default([]),
  },
  (t) => [index('attempts_test_student_idx').on(t.testId, t.studentId), check('attempts_percent_ck', sql`${t.percent} between 0 and 100`)],
);

export const lectureViews = pgTable(
  'lecture_views',
  {
    ...base(),
    lectureId: text('lecture_id')
      .notNull()
      .references(() => lectures.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('lecture_views_user_idx').on(t.userId), index('lecture_views_lecture_idx').on(t.lectureId)],
);

/* ---------- файлы, уведомления, журнал действий ---------- */
export const files = pgTable(
  'files',
  {
    ...base(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    institutionId: text('institution_id').references(() => institutions.id),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
  },
  (t) => [index('files_owner_idx').on(t.ownerId), check('files_scope_ck', sql`${t.scope} in ('content', 'submission')`), check('files_size_ck', sql`${t.size} > 0`)],
);

export const notifications = pgTable(
  'notifications',
  {
    ...base(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    text: text('text').notNull().default(''),
    link: text('link').notNull().default(''),
    readAt: ts('read_at'),
  },
  (t) => [index('notifications_user_idx').on(t.userId)],
);

/* журнал хранит историю: на пользователя и объект ссылается без внешнего ключа */
export const audit = pgTable(
  'audit',
  {
    ...base(),
    institutionId: text('institution_id'),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    summary: text('summary').notNull().default(''),
  },
  (t) => [index('audit_institution_idx').on(t.institutionId), index('audit_created_idx').on(t.createdAt)],
);

/* имена таблиц приложения → таблицы базы */
export const tables = {
  institutions,
  departments,
  users,
  sessions,
  groups,
  groupMembers,
  disciplines,
  courses,
  sections,
  modules,
  lectures,
  tests,
  labs,
  assignments,
  submissions,
  attempts,
  lectureViews,
  files,
  notifications,
  audit,
};
