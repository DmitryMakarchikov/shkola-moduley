/* модель данных */

export type Role = 'owner' | 'director' | 'methodist' | 'teacher' | 'student';
export type CourseStatus = 'draft' | 'review' | 'published' | 'archived';
export type SubmissionStatus = 'submitted' | 'returned' | 'graded';

export interface Base {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

/* учреждение и люди */
export interface Institution extends Base {
  name: string;
  shortName: string;
  city: string;
}

export interface Department extends Base {
  institutionId: string;
  name: string;
}

export interface User extends Base {
  institutionId: string | null;
  role: Role;
  login: string;
  lastName: string;
  firstName: string;
  middleName: string;
  email: string;
  passwordHash: string;
  status: 'active' | 'blocked';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  failedLogins: number;
  lockedUntil: string | null;
  /* Telegram: чат для уведомлений и одноразовый код привязки */
  telegramChatId?: string | null;
  telegramCode?: string | null;
  telegramCodeExpires?: string | null;
}

export interface Session extends Base {
  userId: string;
  tokenHash: string;
  expiresAt: string;
}

export interface Group extends Base {
  institutionId: string;
  departmentId: string | null;
  name: string;
  year: number;
  specialty: string;
  curatorId: string | null;
  joinCode: string;
}

export interface GroupMember extends Base {
  groupId: string;
  studentId: string;
}

/* учебный контент */
export interface Discipline extends Base {
  institutionId: string;
  name: string;
  code: string;
}

export interface Course extends Base {
  institutionId: string;
  disciplineId: string;
  authorId: string;
  title: string;
  description: string;
  status: CourseStatus;
  reviewComment: string;
}

export interface Section extends Base {
  courseId: string;
  title: string;
  position: number;
}

export interface Module extends Base {
  courseId: string;
  sectionId: string;
  title: string;
  position: number;
  goal: string;
  tasks: string[];
  outcomes: string[];
  hours: number;
}

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[]; ordered: boolean }
  | { type: 'note'; text: string; tone: 'info' | 'warn' | 'ok' }
  | { type: 'code'; text: string; lang: string }
  | { type: 'table'; rows: string[][] }
  /* рисунок: загруженный файл (fileId) или рисунок курса из папки сайта (src);
     points — точки-подсказки: нажатие приближает деталь схемы и показывает пояснение */
  | { type: 'image'; fileId: string; caption: string; src?: string; points?: FigurePoint[] }
  | { type: 'video'; url: string; caption: string }
  | { type: 'file'; fileId: string; caption: string }
  | { type: 'term'; term: string; definition: string }
  | { type: 'crossword'; title: string; words: CrosswordWord[] };

/* точка на рисунке: положение в процентах от ширины и высоты, заголовок и пояснение */
export interface FigurePoint {
  x: number;
  y: number;
  title: string;
  text: string;
}

export interface CrosswordWord {
  n: number;
  dir: 'across' | 'down';
  row: number;
  col: number;
  answer: string;
  clue: string;
}

export interface Lecture extends Base {
  moduleId: string;
  title: string;
  position: number;
  blocks: Block[];
}

export type QuestionType = 'single' | 'multi' | 'match' | 'order' | 'short' | 'diagram';

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options: string[];
  /* single: [индекс]; multi: индексы; order: правильный порядок индексов;
     match: правая часть для каждой левой; short: допустимые ответы; diagram: id элемента */
  answer: (string | number)[];
  pairs: string[];
  explain: string;
  points: number;
  /* рисунок к заданию (рисунок курса) */
  image?: string;
  /* варианты ссылаются друг на друга («все перечисленные», «ответы b), d)») — не перемешивать */
  fixed?: boolean;
}

export interface TestSettings {
  timeLimitMin: number;
  attempts: number;
  shuffle: boolean;
  passPercent: number;
  mode: 'self' | 'control';
  /* сколько заданий из банка получает учащийся в одной попытке; 0 — все */
  pick?: number;
  /* черновик: учащиеся тест не видят (например, ещё не отмечены правильные ответы) */
  draft?: boolean;
  /* не пускать дальше: пока тест не сдан на проходной процент, следующие модули закрыты (если остались попытки) */
  gate?: boolean;
}

export interface Test extends Base {
  moduleId: string;
  title: string;
  position: number;
  settings: TestSettings;
  questions: Question[];
}

export interface Lab extends Base {
  moduleId: string;
  title: string;
  position: number;
  goal: string;
  description: string;
  variants: string[];
  criteria: string[];
  templateFileIds: string[];
  maxScore: number;
  allowFiles: boolean;
  diagramKind: string | null;
  diagramReference: unknown | null;
  /* теория, порядок выполнения, форма отчёта — как у лекции */
  blocks?: Block[];
  controlQuestions?: string[];
}

/* обучение и контроль */
export interface Assignment extends Base {
  courseId: string;
  groupId: string;
  teacherId: string;
  dueDates: Record<string, string>;
}

export interface Submission extends Base {
  labId: string;
  studentId: string;
  assignmentId: string | null;
  version: number;
  fileIds: string[];
  comment: string;
  diagram: unknown | null;
  autoScore: number | null;
  status: SubmissionStatus;
  grade: number | null;
  teacherComment: string;
  gradedBy: string | null;
  gradedAt: string | null;
  late: boolean;
}

export interface Attempt extends Base {
  testId: string;
  studentId: string;
  answers: Record<string, unknown>;
  score: number;
  maxScore: number;
  percent: number;
  details: { id: string; correct: boolean }[];
}

export interface LectureView extends Base {
  lectureId: string;
  userId: string;
}

/* файлы, уведомления, журнал действий */
export interface FileRow extends Base {
  ownerId: string;
  institutionId: string | null;
  /* content — материалы курса (видят все в учреждении), submission — сдача работы (автор и сотрудники) */
  scope: 'content' | 'submission';
  name: string;
  mime: string;
  size: number;
}

export interface Notification extends Base {
  userId: string;
  title: string;
  text: string;
  link: string;
  readAt: string | null;
}

export interface AuditEntry extends Base {
  institutionId: string | null;
  actorId: string;
  action: string;
  entity: Table;
  entityId: string;
  summary: string;
}

/* таблицы хранилища */
export interface Tables {
  institutions: Institution;
  departments: Department;
  users: User;
  sessions: Session;
  groups: Group;
  groupMembers: GroupMember;
  disciplines: Discipline;
  courses: Course;
  sections: Section;
  modules: Module;
  lectures: Lecture;
  tests: Test;
  labs: Lab;
  assignments: Assignment;
  submissions: Submission;
  attempts: Attempt;
  lectureViews: LectureView;
  files: FileRow;
  notifications: Notification;
  audit: AuditEntry;
}

export type Table = keyof Tables;

export const TABLES: Table[] = [
  'institutions',
  'departments',
  'users',
  'sessions',
  'groups',
  'groupMembers',
  'disciplines',
  'courses',
  'sections',
  'modules',
  'lectures',
  'tests',
  'labs',
  'assignments',
  'submissions',
  'attempts',
  'lectureViews',
  'files',
  'notifications',
  'audit',
];

/* пользователь без секретов — то, что уходит в интерфейс */
export type PublicUser = Omit<User, 'passwordHash' | 'failedLogins' | 'lockedUntil' | 'telegramCode' | 'telegramCodeExpires' | 'telegramChatId'> & { telegramLinked: boolean };

export const publicUser = (u: User): PublicUser => {
  const { passwordHash: _p, failedLogins: _f, lockedUntil: _l, telegramCode: _c, telegramCodeExpires: _e, telegramChatId: chat, ...rest } = u;
  return { ...rest, telegramLinked: !!chat };
};

export const fullName = (u: Pick<User, 'lastName' | 'firstName' | 'middleName'>) =>
  [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ');

export const shortName = (u: Pick<User, 'lastName' | 'firstName' | 'middleName'>) =>
  `${u.lastName} ${u.firstName ? u.firstName[0] + '.' : ''}${u.middleName ? u.middleName[0] + '.' : ''}`.trim();
