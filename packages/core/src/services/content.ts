/* курсы, разделы, модули и блоки модуля: лекции, тесты, лабораторные работы */
import { isDiagramKind, parseDiagram } from '../diagram.ts';
import { alive, audit, base, getAlive, needRole, needUser, notify, softDelete, touch, type Ctx } from '../context.ts';
import { bad, forbidden } from '../errors.ts';
import type {
  Block,
  Course,
  CourseStatus,
  Lab,
  Lecture,
  Module,
  Question,
  QuestionType,
  Section,
  Test,
  TestSettings,
  User,
} from '../model.ts';
import { canEditCourse, canReviewCourse, canViewCourseAsStaff } from '../roles.ts';
import { arr, bool, idOf, int, obj, oneOf, optId, str } from '../validate.ts';

type ItemTable = 'lectures' | 'tests' | 'labs';
export const ITEM_LABEL: Record<ItemTable, string> = { lectures: 'Лекция', tests: 'Тест', labs: 'Лабораторная работа' };

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

const needEdit = (u: User, c: Course) => {
  if (!canEditCourse(u, c)) throw forbidden('Редактировать курс может автор, директор или владелец платформы');
};

const reviewers = async (ctx: Ctx, institutionId: string) =>
  alive(await ctx.repo.all('users')).filter(
    (u) => u.institutionId === institutionId && (u.role === 'methodist' || u.role === 'director') && u.status === 'active',
  );

/* ---------- разбор блоков, вопросов, настроек ---------- */
const BLOCK_TYPES = ['heading', 'text', 'list', 'note', 'code', 'table', 'image', 'video', 'file', 'term', 'crossword'] as const;

/* рисунки курса лежат в папке сайта: course/<курс>/<файл> */
const COURSE_SRC = /^course\/[a-z0-9-]{1,40}\/[a-z0-9._-]{1,80}\.(webp|png|jpe?g|gif)$/;
const courseSrc = (v: unknown) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !COURSE_SRC.test(v)) throw bad('Недопустимый адрес рисунка');
  return v;
};

export const parseBlocks = (v: unknown): Block[] =>
  arr(v, 'Содержание', (x, i): Block => {
    const b = obj(x, `Блок ${i + 1}`);
    const type = oneOf(b.type, 'Тип блока', BLOCK_TYPES);
    const text = (max = 20000, optional = false) => str(b.text, `Текст блока ${i + 1}`, { max, optional });
    switch (type) {
      case 'heading':
        return { type, text: text(200) };
      case 'text':
        return { type, text: text() };
      case 'list':
        return { type, items: arr(b.items, 'Пункты', (s) => str(s, 'Пункт', { max: 2000 }), 100), ordered: bool(b.ordered) };
      case 'note':
        return { type, text: text(5000), tone: oneOf(b.tone ?? 'info', 'Вид выноски', ['info', 'warn', 'ok'] as const) };
      case 'code':
        return { type, text: str(b.text, 'Код', { max: 20000 }), lang: str(b.lang, 'Язык', { max: 30, optional: true }) };
      case 'table':
        return { type, rows: arr(b.rows, 'Строки', (r) => arr(r, 'Ячейки', (c) => str(c, 'Ячейка', { max: 1000, optional: true }), 12), 100) };
      case 'image': {
        const src = courseSrc(b.src);
        const caption = str(b.caption, 'Подпись', { max: 300, optional: true });
        const img = src ? { type, fileId: '', src, caption } : { type, fileId: idOf(b.fileId, 'Файл'), caption };
        if (b.points === undefined) return img;
        /* точки-подсказки: координаты в процентах, не больше двадцати на рисунок */
        const pct = (v: unknown) => {
          const n = Number(v);
          if (!Number.isFinite(n)) throw bad('Неверное положение точки на рисунке');
          return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
        };
        const points = arr(
          b.points,
          'Точки на рисунке',
          (p) => {
            const o = obj(p, 'Точка');
            return { x: pct(o.x), y: pct(o.y), title: str(o.title, 'Название точки', { max: 120, optional: true }), text: str(o.text, 'Пояснение точки', { max: 1200, optional: true }) };
          },
          20,
        );
        return { ...img, points };
      }
      case 'file':
        return { type, fileId: idOf(b.fileId, 'Файл'), caption: str(b.caption, 'Подпись', { max: 300, optional: true }) };
      case 'video': {
        const url = str(b.url, 'Ссылка на видео', { max: 500 });
        if (!/^https:\/\//.test(url)) throw bad('Ссылка на видео должна начинаться с https://');
        return { type, url, caption: str(b.caption, 'Подпись', { max: 300, optional: true }) };
      }
      case 'term':
        return { type, term: str(b.term, 'Термин', { max: 120 }), definition: str(b.definition, 'Определение', { max: 2000 }) };
      case 'crossword': {
        const words = arr(b.words, 'Слова кроссворда', (w) => {
          const o = obj(w, 'Слово');
          return {
            n: int(o.n, 'Номер', 1, 99),
            dir: oneOf(o.dir, 'Направление', ['across', 'down'] as const),
            row: int(o.row, 'Строка', 0, 40),
            col: int(o.col, 'Столбец', 0, 40),
            answer: str(o.answer, 'Ответ', { max: 30 }).toUpperCase().replace(/Ё/g, 'Е'),
            clue: str(o.clue, 'Подсказка', { max: 500 }),
          };
        }, 60);
        /* буквы на пересечениях должны совпадать */
        const grid = new Map<string, string>();
        for (const w of words) {
          [...w.answer].forEach((ch, k) => {
            const key = w.dir === 'down' ? `${w.row + k}:${w.col}` : `${w.row}:${w.col + k}`;
            if (grid.has(key) && grid.get(key) !== ch) throw bad(`Кроссворд: слова «${w.answer}» и соседнее пересекаются на разных буквах`);
            grid.set(key, ch);
          });
        }
        return { type, title: str(b.title, 'Название кроссворда', { max: 200, optional: true }), words };
      }
    }
  }, 600);

const Q_TYPES: QuestionType[] = ['single', 'multi', 'match', 'order', 'short', 'diagram'];

export const parseQuestions = (v: unknown, draft = false): Question[] =>
  arr(v, 'Задания', (x, i): Question => {
    const q = obj(x, `Задание ${i + 1}`);
    const n = i + 1;
    const type = oneOf(q.type, 'Тип задания', Q_TYPES);
    const options = arr(q.options, 'Варианты', (s) => str(s, 'Вариант', { max: 500 }), 12);
    const pairs = arr(q.pairs, 'Пары', (s) => str(s, 'Пара', { max: 500 }), 12);
    const answer = arr(q.answer, 'Ответ', (a) => (typeof a === 'number' ? a : str(a, 'Ответ', { max: 300 })), 20);
    const image = courseSrc(q.image);
    const question: Question = {
      id: typeof q.id === 'string' && q.id ? q.id.slice(0, 40) : `q${n}`,
      type,
      text: str(q.text, `Формулировка задания ${n}`, { max: 2000 }),
      options,
      pairs,
      answer,
      explain: str(q.explain, 'Пояснение', { max: 2000, optional: true }),
      points: q.points === undefined ? 1 : int(q.points, 'Баллы', 1, 10),
      ...(image ? { image } : {}),
      ...(q.fixed ? { fixed: true } : {}),
    };
    if (draft && (type === 'single' || type === 'multi') && answer.length === 0) return question;
    const inRange = (a: unknown) => typeof a === 'number' && Number.isInteger(a) && a >= 0 && a < options.length;
    if (type === 'single' && (options.length < 2 || answer.length !== 1 || !inRange(answer[0]))) {
      throw bad(`Задание ${n}: нужны варианты и один правильный ответ`);
    }
    if (type === 'multi' && (options.length < 2 || answer.length < 1 || !answer.every(inRange))) {
      throw bad(`Задание ${n}: отметьте хотя бы один правильный вариант`);
    }
    if (type === 'order' && options.length < 2) throw bad(`Задание ${n}: нужно не меньше двух шагов`);
    if (type === 'match' && (options.length < 2 || pairs.length !== options.length)) {
      throw bad(`Задание ${n}: у каждого элемента должна быть пара`);
    }
    if (type === 'short' && !answer.length) throw bad(`Задание ${n}: укажите хотя бы один допустимый ответ`);
    if (type === 'diagram' && answer.length !== 1) throw bad(`Задание ${n}: укажите правильный элемент диаграммы`);
    return question;
  }, 50);

export const parseSettings = (v: unknown): TestSettings => {
  const s = v ? obj(v, 'Настройки теста') : {};
  const mode = s.mode === undefined ? 'self' : oneOf(s.mode, 'Режим', ['self', 'control'] as const);
  return {
    timeLimitMin: s.timeLimitMin === undefined ? 0 : int(s.timeLimitMin, 'Время на тест', 0, 240),
    attempts: s.attempts === undefined ? 0 : int(s.attempts, 'Число попыток', 0, 20),
    shuffle: bool(s.shuffle, true),
    passPercent: s.passPercent === undefined ? 60 : int(s.passPercent, 'Проходной процент', 0, 100),
    mode,
    pick: s.pick === undefined ? 0 : int(s.pick, 'Заданий в попытке', 0, 50),
    draft: bool(s.draft, false),
    /* по умолчанию тест для самопроверки не пускает дальше, контрольная — пускает */
    gate: bool(s.gate, mode !== 'control'),
  };
};

const textList = (v: unknown, field: string, max = 30) => arr(v, field, (s) => str(s, field, { max: 1000 }), max);

/* ---------- курсы ---------- */
export const listCourses = async (ctx: Ctx, query: Record<string, string | undefined> = {}) => {
  const u = needUser(ctx);
  let rows = alive(await ctx.repo.all('courses'));
  if (u.role === 'student') throw forbidden('Учащимся курсы доступны в разделе «Мои курсы»');
  rows = rows.filter((c) => canViewCourseAsStaff(u, c));
  if (query.status) rows = rows.filter((c) => c.status === query.status);
  if (query.disciplineId) rows = rows.filter((c) => c.disciplineId === query.disciplineId);
  if (query.mine) rows = rows.filter((c) => c.authorId === u.id);
  const users = new Map((await ctx.repo.all('users')).map((x) => [x.id, x]));
  const disciplines = new Map((await ctx.repo.all('disciplines')).map((d) => [d.id, d]));
  const modules = alive(await ctx.repo.all('modules'));
  return rows
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => {
      const author = users.get(c.authorId);
      return {
        ...c,
        authorName: author ? `${author.lastName} ${author.firstName}` : '',
        disciplineName: disciplines.get(c.disciplineId)?.name ?? '',
        moduleCount: modules.filter((m) => m.courseId === c.id).length,
        canEdit: canEditCourse(u, c),
        canReview: canReviewCourse(u, c),
      };
    });
};

/* полное дерево курса для сотрудника */
export const getCourse = async (ctx: Ctx, id: string) => {
  const u = needUser(ctx);
  const c = await getAlive(ctx, 'courses', id, 'Курс');
  if (!canViewCourseAsStaff(u, c)) throw forbidden();
  const sections = alive(await ctx.repo.find('sections', { courseId: id })).sort(byPos);
  const modules = alive(await ctx.repo.find('modules', { courseId: id })).sort(byPos);
  const items = async (table: ItemTable, moduleId: string) =>
    alive(await ctx.repo.find(table, { moduleId }))
      .sort(byPos)
      .map((x) => ({ id: x.id, title: x.title, position: x.position }));
  const tree = [];
  for (const s of sections) {
    const mods = [];
    for (const m of modules.filter((x) => x.sectionId === s.id)) {
      mods.push({ ...m, lectures: await items('lectures', m.id), tests: await items('tests', m.id), labs: await items('labs', m.id) });
    }
    tree.push({ ...s, modules: mods });
  }
  const discipline = await ctx.repo.get('disciplines', c.disciplineId);
  const author = await ctx.repo.get('users', c.authorId);
  return {
    ...c,
    disciplineName: discipline?.name ?? '',
    authorName: author ? `${author.lastName} ${author.firstName} ${author.middleName}`.trim() : '',
    sections: tree,
    canEdit: canEditCourse(u, c),
    canReview: canReviewCourse(u, c),
  };
};

export const createCourse = async (ctx: Ctx, input: unknown) => {
  const u = needRole(ctx, 'owner', 'director', 'teacher');
  const b = obj(input);
  const discipline = await getAlive(ctx, 'disciplines', idOf(b.disciplineId, 'Дисциплина'), 'Дисциплина');
  if (u.role !== 'owner' && discipline.institutionId !== u.institutionId) throw forbidden();
  let authorId = u.id;
  if (u.role !== 'teacher' && optId(b.authorId)) {
    const author = await getAlive(ctx, 'users', optId(b.authorId)!, 'Автор');
    if (author.role !== 'teacher' || author.institutionId !== discipline.institutionId) throw bad('Автором курса может быть преподаватель учреждения');
    authorId = author.id;
  }
  const row: Course = {
    ...base(ctx),
    institutionId: discipline.institutionId,
    disciplineId: discipline.id,
    authorId,
    title: str(b.title, 'Название курса', { max: 200 }),
    description: str(b.description, 'Описание', { max: 2000, optional: true }),
    status: 'draft',
    reviewComment: '',
  };
  await ctx.repo.insert('courses', row);
  await audit(ctx, 'create', 'courses', row.id, `Курс «${row.title}»`, row.institutionId);
  return row;
};

export const updateCourse = async (ctx: Ctx, id: string, input: unknown) => {
  const u = needUser(ctx);
  const c = await getAlive(ctx, 'courses', id, 'Курс');
  needEdit(u, c);
  const b = obj(input);
  const row = await ctx.repo.update('courses', id, {
    title: b.title !== undefined ? str(b.title, 'Название курса', { max: 200 }) : c.title,
    description: b.description !== undefined ? str(b.description, 'Описание', { max: 2000, optional: true }) : c.description,
    ...touch(ctx),
  });
  await audit(ctx, 'update', 'courses', id, `Курс «${row.title}» изменён`, row.institutionId);
  return row;
};

/* курс с результатами учащихся не удаляется, а уходит в архив */
export const removeCourse = async (ctx: Ctx, id: string) => {
  const u = needUser(ctx);
  const c = await getAlive(ctx, 'courses', id, 'Курс');
  needEdit(u, c);
  const modules = alive(await ctx.repo.find('modules', { courseId: id }));
  let hasResults = alive(await ctx.repo.find('assignments', { courseId: id })).length > 0;
  for (const m of modules) {
    if (hasResults) break;
    for (const t of await ctx.repo.find('tests', { moduleId: m.id })) if ((await ctx.repo.find('attempts', { testId: t.id })).length) hasResults = true;
    for (const l of await ctx.repo.find('labs', { moduleId: m.id })) if ((await ctx.repo.find('submissions', { labId: l.id })).length) hasResults = true;
  }
  if (hasResults) {
    await ctx.repo.update('courses', id, { status: 'archived', ...touch(ctx) });
    await audit(ctx, 'archive', 'courses', id, `Курс «${c.title}» переведён в архив (есть результаты учащихся)`, c.institutionId);
    return { archived: true };
  }
  await softDelete(ctx, 'courses', id);
  await audit(ctx, 'delete', 'courses', id, `Курс «${c.title}» удалён в корзину`, c.institutionId);
  return { archived: false };
};

/* статусы: черновик → на проверке → опубликован → архив */
export const setCourseStatus = async (ctx: Ctx, id: string, input: unknown) => {
  const u = needUser(ctx);
  const c = await getAlive(ctx, 'courses', id, 'Курс');
  const b = obj(input);
  const action = oneOf(b.action, 'Действие', ['submit', 'approve', 'reject', 'publish', 'archive', 'restore'] as const);
  const comment = str(b.comment, 'Комментарий', { max: 2000, optional: true });
  const admin = u.role === 'owner' || (u.role === 'director' && u.institutionId === c.institutionId);
  let next: CourseStatus;
  if (action === 'submit') {
    needEdit(u, c);
    if (c.status !== 'draft') throw bad('На проверку отправляется только черновик');
    next = 'review';
  } else if (action === 'approve' || action === 'reject') {
    if (!canReviewCourse(u, c)) throw forbidden('Утверждает курс методист или директор');
    if (c.status !== 'review') throw bad('Курс не на проверке');
    if (action === 'reject' && !comment) throw bad('Напишите, что исправить в курсе');
    next = action === 'approve' ? 'published' : 'draft';
  } else if (action === 'publish') {
    if (!admin) throw forbidden('Опубликовать курс без проверки может директор');
    next = 'published';
  } else if (action === 'archive') {
    if (!admin && c.authorId !== u.id) throw forbidden();
    next = 'archived';
  } else {
    if (!admin) throw forbidden();
    if (c.status !== 'archived') throw bad('Курс не в архиве');
    next = 'draft';
  }
  const row = await ctx.repo.update('courses', id, {
    status: next,
    reviewComment: action === 'reject' ? comment : action === 'approve' ? '' : c.reviewComment,
    ...touch(ctx),
  });
  const labels: Record<CourseStatus, string> = { draft: 'черновик', review: 'на проверке', published: 'опубликован', archived: 'в архиве' };
  await audit(ctx, 'status', 'courses', id, `Курс «${c.title}»: ${labels[next]}`, c.institutionId);
  if (action === 'submit') {
    await notify(ctx, (await reviewers(ctx, c.institutionId)).map((r) => r.id), 'Курс на проверке', `**«${c.title}»**\nЖдёт решения: утвердить или вернуть на доработку.`, `/courses/${id}`);
  }
  if (action === 'approve' || action === 'reject') {
    await notify(
      ctx,
      [c.authorId],
      action === 'approve' ? 'Курс опубликован' : 'Курс возвращён на доработку',
      action === 'approve' ? `**«${c.title}»** утверждён — теперь его можно назначать группам.` : `**«${c.title}»**\nЧто исправить: ${comment}`,
      `/courses/${id}`,
    );
  }
  return row;
};

/* копия курса со всем содержимым — новым черновиком */
export const duplicateCourse = async (ctx: Ctx, id: string) => {
  const u = needRole(ctx, 'owner', 'director', 'teacher');
  const c = await getAlive(ctx, 'courses', id, 'Курс');
  if (!canViewCourseAsStaff(u, c)) throw forbidden();
  return ctx.repo.tx(async () => {
    const copy: Course = { ...c, ...base(ctx), title: `${c.title} (копия)`, status: 'draft', reviewComment: '', authorId: u.role === 'teacher' ? u.id : c.authorId };
    await ctx.repo.insert('courses', copy);
    const sectionMap = new Map<string, string>();
    for (const s of alive(await ctx.repo.find('sections', { courseId: id }))) {
      const ns: Section = { ...s, ...base(ctx), courseId: copy.id };
      sectionMap.set(s.id, ns.id);
      await ctx.repo.insert('sections', ns);
    }
    for (const m of alive(await ctx.repo.find('modules', { courseId: id }))) {
      const nm: Module = { ...m, ...base(ctx), courseId: copy.id, sectionId: sectionMap.get(m.sectionId) ?? m.sectionId };
      await ctx.repo.insert('modules', nm);
      for (const table of ['lectures', 'tests', 'labs'] as const) {
        for (const item of alive(await ctx.repo.find(table, { moduleId: m.id }))) {
          await ctx.repo.insert(table, { ...item, ...base(ctx), moduleId: nm.id } as never);
        }
      }
    }
    await audit(ctx, 'create', 'courses', copy.id, `Копия курса «${c.title}»`, c.institutionId);
    return copy;
  });
};

/* ---------- разделы ---------- */
const nextPos = (rows: { position: number }[]) => (rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 1);

export const createSection = async (ctx: Ctx, courseId: string, input: unknown) => {
  const u = needUser(ctx);
  const c = await getAlive(ctx, 'courses', courseId, 'Курс');
  needEdit(u, c);
  const siblings = alive(await ctx.repo.find('sections', { courseId }));
  const row: Section = { ...base(ctx), courseId, title: str(obj(input).title, 'Название раздела', { max: 200 }), position: nextPos(siblings) };
  await ctx.repo.insert('sections', row);
  await audit(ctx, 'create', 'sections', row.id, `Раздел «${row.title}» в курсе «${c.title}»`, c.institutionId);
  return row;
};

export const updateSection = async (ctx: Ctx, id: string, input: unknown) => {
  const u = needUser(ctx);
  const s = await getAlive(ctx, 'sections', id, 'Раздел');
  needEdit(u, await getAlive(ctx, 'courses', s.courseId, 'Курс'));
  return ctx.repo.update('sections', id, { title: str(obj(input).title, 'Название раздела', { max: 200 }), ...touch(ctx) });
};

export const removeSection = async (ctx: Ctx, id: string) => {
  const u = needUser(ctx);
  const s = await getAlive(ctx, 'sections', id, 'Раздел');
  const c = await getAlive(ctx, 'courses', s.courseId, 'Курс');
  needEdit(u, c);
  await ctx.repo.tx(async () => {
    for (const m of alive(await ctx.repo.find('modules', { sectionId: id }))) await softDelete(ctx, 'modules', m.id);
    await softDelete(ctx, 'sections', id);
    await audit(ctx, 'delete', 'sections', id, `Раздел «${s.title}» удалён в корзину`, c.institutionId);
  });
  return { ok: true };
};

/* перестановка вверх-вниз среди соседей */
const move = async <T extends 'sections' | 'modules' | ItemTable>(ctx: Ctx, table: T, row: { id: string; position: number }, siblings: { id: string; position: number }[], dir: unknown) => {
  const d = oneOf(dir, 'Направление', ['up', 'down'] as const);
  const sorted = siblings.slice().sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((x) => x.id === row.id);
  const j = d === 'up' ? i - 1 : i + 1;
  const other = sorted[j];
  if (i < 0 || !other) return { ok: true };
  await ctx.repo.tx(async () => {
    await ctx.repo.update(table, row.id, { position: other.position, ...touch(ctx) } as never);
    await ctx.repo.update(table, other.id, { position: row.position, ...touch(ctx) } as never);
  });
  return { ok: true };
};

export const moveSection = async (ctx: Ctx, id: string, input: unknown) => {
  const u = needUser(ctx);
  const s = await getAlive(ctx, 'sections', id, 'Раздел');
  needEdit(u, await getAlive(ctx, 'courses', s.courseId, 'Курс'));
  return move(ctx, 'sections', s, alive(await ctx.repo.find('sections', { courseId: s.courseId })), obj(input).direction);
};

/* ---------- модули ---------- */
const moduleFields = (b: Record<string, unknown>, cur?: Module) => ({
  title: b.title !== undefined ? str(b.title, 'Тема модуля', { max: 200 }) : (cur?.title ?? ''),
  goal: b.goal !== undefined ? str(b.goal, 'Цель', { max: 2000, optional: true }) : (cur?.goal ?? ''),
  tasks: b.tasks !== undefined ? textList(b.tasks, 'Задачи') : (cur?.tasks ?? []),
  outcomes: b.outcomes !== undefined ? textList(b.outcomes, 'Результаты') : (cur?.outcomes ?? []),
  hours: b.hours !== undefined ? int(b.hours, 'Часы', 1, 40) : (cur?.hours ?? 2),
});

export const createModule = async (ctx: Ctx, sectionId: string, input: unknown) => {
  const u = needUser(ctx);
  const s = await getAlive(ctx, 'sections', sectionId, 'Раздел');
  const c = await getAlive(ctx, 'courses', s.courseId, 'Курс');
  needEdit(u, c);
  const fields = moduleFields(obj(input));
  if (!fields.title) throw bad('Заполните поле «Тема модуля»');
  const siblings = alive(await ctx.repo.find('modules', { courseId: c.id }));
  const row: Module = { ...base(ctx), courseId: c.id, sectionId, position: nextPos(siblings), ...fields };
  await ctx.repo.insert('modules', row);
  await audit(ctx, 'create', 'modules', row.id, `Модуль «${row.title}»`, c.institutionId);
  return row;
};

/* модуль целиком для сотрудника: с блоками */
export const getModule = async (ctx: Ctx, id: string) => {
  const u = needUser(ctx);
  const m = await getAlive(ctx, 'modules', id, 'Модуль');
  const c = await getAlive(ctx, 'courses', m.courseId, 'Курс');
  if (!canViewCourseAsStaff(u, c)) throw forbidden();
  return {
    ...m,
    course: { id: c.id, title: c.title, status: c.status },
    lectures: alive(await ctx.repo.find('lectures', { moduleId: id })).sort(byPos),
    tests: alive(await ctx.repo.find('tests', { moduleId: id })).sort(byPos),
    labs: alive(await ctx.repo.find('labs', { moduleId: id })).sort(byPos),
    canEdit: canEditCourse(u, c),
  };
};

export const updateModule = async (ctx: Ctx, id: string, input: unknown) => {
  const u = needUser(ctx);
  const m = await getAlive(ctx, 'modules', id, 'Модуль');
  const c = await getAlive(ctx, 'courses', m.courseId, 'Курс');
  needEdit(u, c);
  const row = await ctx.repo.update('modules', id, { ...moduleFields(obj(input), m), ...touch(ctx) });
  await audit(ctx, 'update', 'modules', id, `Модуль «${row.title}» изменён`, c.institutionId);
  return row;
};

export const removeModule = async (ctx: Ctx, id: string) => {
  const u = needUser(ctx);
  const m = await getAlive(ctx, 'modules', id, 'Модуль');
  const c = await getAlive(ctx, 'courses', m.courseId, 'Курс');
  needEdit(u, c);
  await softDelete(ctx, 'modules', id);
  await audit(ctx, 'delete', 'modules', id, `Модуль «${m.title}» удалён в корзину`, c.institutionId);
  return { ok: true };
};

export const moveModule = async (ctx: Ctx, id: string, input: unknown) => {
  const u = needUser(ctx);
  const m = await getAlive(ctx, 'modules', id, 'Модуль');
  needEdit(u, await getAlive(ctx, 'courses', m.courseId, 'Курс'));
  return move(ctx, 'modules', m, alive(await ctx.repo.find('modules', { sectionId: m.sectionId })), obj(input).direction);
};

/* ---------- блоки модуля ---------- */
const itemFields = async (ctx: Ctx, table: ItemTable, b: Record<string, unknown>, institutionId: string) => {
  const title = str(b.title, 'Название', { max: 200 });
  if (table === 'lectures') return { title, blocks: parseBlocks(b.blocks) };
  if (table === 'tests') {
    const settings = parseSettings(b.settings);
    return { title, settings, questions: parseQuestions(b.questions, settings.draft) };
  }
  const templateFileIds = arr(b.templateFileIds, 'Файлы-шаблоны', (x) => idOf(x, 'Файл'), 10);
  for (const fid of templateFileIds) {
    const f = await getAlive(ctx, 'files', fid, 'Файл');
    if (f.institutionId !== institutionId) throw bad('Файл из другого учреждения');
  }
  const diagramKind = optId(b.diagramKind);
  if (diagramKind && !isDiagramKind(diagramKind)) throw bad('Неизвестный вид диаграммы');
  /* эталон: одна диаграмма на все варианты или список по вариантам */
  const rawRef = b.diagramReference ?? null;
  if (rawRef !== null && JSON.stringify(rawRef).length > 400_000) throw bad('Эталонная диаграмма слишком большая');
  const ref = !diagramKind || rawRef === null ? null : Array.isArray(rawRef) ? rawRef.slice(0, 60).map((r) => (r ? parseDiagram(r, diagramKind) : null)) : parseDiagram(rawRef, diagramKind);
  return {
    title,
    goal: str(b.goal, 'Цель работы', { max: 2000, optional: true }),
    description: str(b.description, 'Задание', { max: 20000, optional: true }),
    variants: textList(b.variants, 'Варианты', 60),
    criteria: textList(b.criteria, 'Критерии оценивания'),
    templateFileIds,
    maxScore: 10,
    allowFiles: bool(b.allowFiles, true),
    diagramKind,
    diagramReference: ref,
    blocks: b.blocks === undefined ? [] : parseBlocks(b.blocks),
    controlQuestions: textList(b.controlQuestions ?? [], 'Контрольные вопросы', 40),
  };
};

const moduleAndCourse = async (ctx: Ctx, moduleId: string) => {
  const m = await getAlive(ctx, 'modules', moduleId, 'Модуль');
  const c = await getAlive(ctx, 'courses', m.courseId, 'Курс');
  return { m, c };
};

export const createItem = async (ctx: Ctx, table: ItemTable, moduleId: string, input: unknown) => {
  const u = needUser(ctx);
  const { m, c } = await moduleAndCourse(ctx, moduleId);
  needEdit(u, c);
  const fields = await itemFields(ctx, table, obj(input), c.institutionId);
  const siblings = alive(await ctx.repo.find(table, { moduleId }));
  const row = { ...base(ctx), moduleId, position: nextPos(siblings), ...fields } as Lecture | Test | Lab;
  await ctx.repo.insert(table, row as never);
  await audit(ctx, 'create', table, row.id, `${ITEM_LABEL[table]} «${row.title}» в модуле «${m.title}»`, c.institutionId);
  return row;
};

export const getItem = async (ctx: Ctx, table: ItemTable, id: string) => {
  const u = needUser(ctx);
  const item = await getAlive(ctx, table, id, ITEM_LABEL[table]);
  const { m, c } = await moduleAndCourse(ctx, item.moduleId);
  if (!canViewCourseAsStaff(u, c)) throw forbidden();
  /* у лабораторной — имена файлов-шаблонов */
  const templates = [];
  for (const fid of table === 'labs' ? (item as { templateFileIds: string[] }).templateFileIds : []) {
    const f = await ctx.repo.get('files', fid);
    if (f && !f.deletedAt) templates.push({ id: f.id, name: f.name });
  }
  return { ...item, templates, module: { id: m.id, title: m.title }, course: { id: c.id, title: c.title }, canEdit: canEditCourse(u, c) };
};

export const updateItem = async (ctx: Ctx, table: ItemTable, id: string, input: unknown) => {
  const u = needUser(ctx);
  const item = await getAlive(ctx, table, id, ITEM_LABEL[table]);
  const { c } = await moduleAndCourse(ctx, item.moduleId);
  needEdit(u, c);
  const row = await ctx.repo.update(table, id, { ...(await itemFields(ctx, table, obj(input), c.institutionId)), ...touch(ctx) } as never);
  await audit(ctx, 'update', table, id, `${ITEM_LABEL[table]} «${row.title}» изменена`, c.institutionId);
  return row;
};

export const removeItem = async (ctx: Ctx, table: ItemTable, id: string) => {
  const u = needUser(ctx);
  const item = await getAlive(ctx, table, id, ITEM_LABEL[table]);
  const { c } = await moduleAndCourse(ctx, item.moduleId);
  needEdit(u, c);
  await softDelete(ctx, table, id);
  await audit(ctx, 'delete', table, id, `${ITEM_LABEL[table]} «${item.title}» удалена в корзину`, c.institutionId);
  return { ok: true };
};

export const moveItem = async (ctx: Ctx, table: ItemTable, id: string, input: unknown) => {
  const u = needUser(ctx);
  const item = await getAlive(ctx, table, id, ITEM_LABEL[table]);
  needEdit(u, (await moduleAndCourse(ctx, item.moduleId)).c);
  return move(ctx, table, item, alive(await ctx.repo.find(table, { moduleId: item.moduleId })), obj(input).direction);
};
