/* поиск по платформе (Ctrl+K) и словарь терминов курса.
   Ищем только в том, что пользователь и так может открыть: учащийся — в назначенных курсах и открытых модулях,
   сотрудник — в курсах, группах и списках учащихся своего учреждения */
import { alive, needUser, type Ctx } from '../context.ts';
import { fullName, type Block, type Lab, type Lecture, type Module, type User } from '../model.ts';
import { canViewCourseAsStaff, isStaff } from '../roles.ts';
import { learnCourse, myCourseViews } from './learn.ts';
import { progressScope } from './progress.ts';

/* ---------- сравнение строк ---------- */
/* без регистра, «ё» и знаков ударения; map — позиция каждого символа в исходной строке (для выдержки) */
const foldMap = (s: string) => {
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '̀' || ch === '́') continue;
    const low = ch.toLowerCase()[0]!;
    out += low === 'ё' ? 'е' : low;
    map.push(i);
  }
  return { out, map };
};

export const fold = (s: string) => foldMap(s).out;

/* слово запроса совпадает с началом слова текста: «актёр» находит «актёра» и «актёры», но не «характер» */
const LETTER = /[a-zа-я0-9]/;
const wordAt = (f: string, w: string, from = 0) => {
  for (let i = f.indexOf(w, from); i >= 0; i = f.indexOf(w, i + 1)) if (i === 0 || !LETTER.test(f[i - 1]!)) return i;
  return -1;
};

/* все слова запроса есть в тексте */
export const hasWords = (text: string, words: string[]) => {
  const f = fold(text);
  return words.every((w) => wordAt(f, w) >= 0);
};

/* слова запроса: без повторов, от двух символов (номер темы — и из одной цифры) */
export const queryWords = (q: string) =>
  [...new Set(fold(q).split(/[\s,.;:!?«»"'()[\]{}/\\|]+/).filter((w) => w.length >= 2 || /^\d$/.test(w)))].slice(0, 6);

/* где в тексте встречаются слова запроса — для подсветки в интерфейсе */
export const findRanges = (text: string, words: string[]) => {
  const { out, map } = foldMap(text);
  const ranges: [number, number][] = [];
  for (const w of words) {
    let i = wordAt(out, w);
    while (i >= 0 && ranges.length < 200) {
      ranges.push([map[i]!, map[i + w.length - 1]! + 1]);
      i = wordAt(out, w, i + w.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  /* пересечения склеиваем */
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
};

const plain = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/* текст блока лекции, по которому ищем */
export const blockText = (b: Block): string => {
  switch (b.type) {
    case 'heading':
    case 'text':
    case 'note':
    case 'code':
      return b.text;
    case 'list':
      return b.items.join('. ');
    case 'table':
      return b.rows.map((r) => r.join(' ')).join('. ');
    case 'term':
      return `${b.term} — ${b.definition}`;
    case 'image':
    case 'video':
    case 'file':
      return b.caption;
    case 'crossword':
      return [b.title, ...b.words.map((w) => w.clue)].join('. ');
    default:
      return '';
  }
};

/* выдержка вокруг первого найденного слова */
const snippet = (text: string, words: string[], size = 150) => {
  const t = plain(text);
  if (!t) return '';
  const { out, map } = foldMap(t);
  let at = -1;
  for (const w of words) {
    const i = wordAt(out, w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return t.length > size ? `${t.slice(0, size).replace(/\s+\S*$/, '')}…` : t;
  const pos = map[at]!;
  let start = Math.max(0, pos - Math.round(size / 3));
  if (start > 0) start = t.indexOf(' ', start) + 1 || start;
  let end = Math.min(t.length, start + size);
  if (end < t.length) end = t.lastIndexOf(' ', end) > pos ? t.lastIndexOf(' ', end) : end;
  return `${start > 0 ? '…' : ''}${t.slice(start, end)}${end < t.length ? '…' : ''}`;
};

/* оценка совпадения: все слова должны найтись в названии или тексте; совпадение в названии весит больше */
const score = (title: string, text: string, words: string[]) => {
  const ft = fold(title);
  const fx = fold(text);
  let s = 0;
  for (const w of words) {
    const t = wordAt(ft, w);
    if (t < 0 && wordAt(fx, w) < 0) return 0;
    /* в названии; в самом начале; целым словом */
    if (t >= 0) s += 10 + (t === 0 ? 6 : 0) + (!LETTER.test(ft[t + w.length] ?? ' ') ? 3 : 0);
    let n = 0;
    for (let i = wordAt(fx, w); i >= 0 && n < 5; i = wordAt(fx, w, i + w.length)) n++;
    s += n;
  }
  return s;
};

export type SearchKind = 'course' | 'module' | 'lecture' | 'term' | 'test' | 'lab' | 'group' | 'student';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /* где находится: курс, тема */
  sub: string;
  snippet: string;
  link: string;
  score: number;
}

const KIND_WEIGHT: Record<SearchKind, number> = { term: 1.3, module: 1.25, lecture: 1.1, course: 1.2, test: 1, lab: 1, group: 1.2, student: 1.1 };

/* чистое название термина: без номера пункта в начале («2.Основные…») и с пробелом перед скобкой */
export const cleanTerm = (t: string) => plain(t.replace(/^\s*\d+\s*[.)]\s*/, '').replace(/([^\s(])\(/g, '$1 ('));

const LAB_LIGHT: (keyof Lab)[] = ['blocks', 'variants', 'criteria', 'diagramReference', 'controlQuestions', 'templateFileIds'];

export const search = async (ctx: Ctx, query: Record<string, string | undefined>) => {
  const u = needUser(ctx);
  const q = (query.q ?? '').slice(0, 120);
  const words = queryWords(q);
  if (!words.length) return { q, words, hits: [] as SearchHit[] };
  const hits: SearchHit[] = [];
  const add = (h: Omit<SearchHit, 'score'>, title: string, text: string) => {
    const s = score(title, text, words);
    if (s > 0) hits.push({ ...h, score: Math.round(s * KIND_WEIGHT[h.kind] * 10) / 10 });
  };
  const enc = encodeURIComponent(q);

  /* содержимое курсов: темы, лекции (и термины в них), тесты, лабораторные */
  const scan = async (
    course: { id: string; title: string; description: string },
    mods: (Pick<Module, 'id' | 'title' | 'goal' | 'outcomes' | 'position'> & { tests: { id: string; title: string; text?: string }[] })[],
    staff: boolean,
  ) => {
    add({ kind: 'course', id: course.id, title: course.title, sub: 'Курс', snippet: snippet(course.description, words), link: staff ? `/courses/${course.id}` : `/learn/${course.id}` }, course.title, course.description);
    const ids = mods.map((m) => m.id);
    const lectures = alive(await ctx.repo.list('lectures', 'moduleId', ids));
    const labs = alive(await ctx.repo.list('labs', 'moduleId', ids, LAB_LIGHT));
    const seenTerm = new Set<string>();
    mods.forEach((m, i) => {
      const where = `Тема ${i + 1} · ${course.title}`;
      const about = [m.goal, ...m.outcomes].join('. ');
      add({ kind: 'module', id: m.id, title: m.title, sub: `Тема ${i + 1} · ${course.title}`, snippet: snippet(about, words), link: staff ? `/modules/${m.id}` : `/learn/${course.id}?m=${m.id}` }, m.title, about);
      for (const l of lectures.filter((x) => x.moduleId === m.id)) {
        const text = (l as Lecture).blocks.map(blockText).join('. ');
        add({ kind: 'lecture', id: l.id, title: l.title, sub: `Лекция · ${where}`, snippet: snippet(text, words), link: `/learn/lecture/${l.id}?q=${enc}` }, l.title, text);
        for (const b of (l as Lecture).blocks) {
          if (b.type !== 'term') continue;
          const term = cleanTerm(b.term);
          const key = fold(term);
          if (seenTerm.has(key)) continue;
          const s = score(term, b.definition, words);
          if (!s) continue;
          seenTerm.add(key);
          hits.push({ kind: 'term', id: `${l.id}:${key}`, title: term, sub: `Термин · ${where}`, snippet: snippet(b.definition, words), link: `/learn/${course.id}/glossary?t=${encodeURIComponent(term)}`, score: Math.round(s * KIND_WEIGHT.term * 10) / 10 });
        }
      }
      for (const t of m.tests) add({ kind: 'test', id: t.id, title: t.title, sub: `Тест · ${where}`, snippet: t.text ? snippet(t.text, words) : '', link: staff ? `/edit/tests/${t.id}` : `/learn/test/${t.id}` }, t.title, t.text ?? '');
      for (const b of labs.filter((x) => x.moduleId === m.id)) {
        const text = [b.goal, b.description].join('. ');
        add({ kind: 'lab', id: b.id, title: b.title, sub: `Лабораторная · ${where}`, snippet: snippet(text, words), link: staff ? `/edit/labs/${b.id}` : `/learn/lab/${b.id}` }, b.title, text);
      }
    });
  };

  if (!isStaff(u)) {
    /* учащийся: назначенные курсы; закрытые замком модули не показываем — их всё равно нельзя открыть */
    for (const v of await myCourseViews(ctx)) {
      const mods = v.sections.flatMap((s) => s.modules).filter((m) => !m.locked);
      await scan(v, mods.map((m) => ({ ...m, tests: m.tests.map((t) => ({ id: t.id, title: t.title })) })), false);
    }
  } else {
    const courses = alive(await ctx.repo.all('courses')).filter((c) => canViewCourseAsStaff(u, c) && c.status !== 'archived');
    for (const c of courses) {
      const mods = alive(await ctx.repo.find('modules', { courseId: c.id })).sort((a, b) => a.position - b.position);
      const tests = alive(await ctx.repo.list('tests', 'moduleId', mods.map((m) => m.id)));
      await scan(
        c,
        mods.map((m) => ({
          ...m,
          tests: tests
            .filter((t) => t.moduleId === m.id)
            .sort((a, b) => a.position - b.position)
            .map((t) => ({ id: t.id, title: t.title, text: t.questions.map((x) => x.text).join('. ') })),
        })),
        true,
      );
    }
    /* группы и учащиеся своего учреждения */
    const groups = alive(await ctx.repo.all('groups')).filter((g) => u.role === 'owner' || g.institutionId === u.institutionId);
    const scope = await progressScope(ctx, u);
    for (const g of groups) add({ kind: 'group', id: g.id, title: g.name, sub: [g.specialty, `${g.year} курс`].filter(Boolean).join(' · '), snippet: '', link: scope.has(g.id) ? `/progress/${g.id}` : `/groups/${g.id}` }, `${g.name} ${g.specialty}`, '');
    const byStudent = new Map<string, string>();
    for (const m of alive(await ctx.repo.list('groupMembers', 'groupId', groups.map((g) => g.id)))) if (!byStudent.has(m.studentId)) byStudent.set(m.studentId, m.groupId);
    const students = (await ctx.repo.list('users', 'id', [...byStudent.keys()], ['passwordHash'])).filter((s) => !s.deletedAt && s.role === 'student') as User[];
    for (const s of students) {
      const gid = byStudent.get(s.id)!;
      const g = groups.find((x) => x.id === gid);
      const name = fullName(s);
      add({ kind: 'student', id: s.id, title: name, sub: `Учащийся · ${g?.name ?? ''}`, snippet: '', link: scope.has(gid) ? `/progress/${gid}?s=${encodeURIComponent(s.lastName)}` : `/groups/${gid}` }, name, s.login);
    }
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ru'));
  /* не больше восьми результатов одного вида: в выдаче видны все виды */
  const per = new Map<SearchKind, number>();
  const out = hits.filter((h) => {
    const n = per.get(h.kind) ?? 0;
    per.set(h.kind, n + 1);
    return n < 8;
  });
  return { q, words, hits: out.slice(0, 40) };
};

/* ---------- словарь курса ---------- */
/* термины из лекций курса (блоки «Термин»), по алфавиту; один термин из разных тем — с несколькими определениями */
export const courseGlossary = async (ctx: Ctx, courseId: string) => {
  const v = await learnCourse(ctx, courseId);
  const mods = v.sections.flatMap((s, si) => s.modules.map((m) => ({ ...m, section: s.title, sectionNo: si + 1 })));
  const no = new Map(mods.map((m, i) => [m.id, i + 1]));
  const lectures = alive(await ctx.repo.list('lectures', 'moduleId', mods.map((m) => m.id))).sort(
    (a, b) => (no.get(a.moduleId)! - no.get(b.moduleId)!) || a.position - b.position,
  );
  const terms = new Map<string, { term: string; letter: string; defs: { text: string; lectureId: string; lecture: string; moduleId: string; module: string; moduleNo: number; section: string; locked: boolean }[] }>();
  for (const l of lectures) {
    const m = mods.find((x) => x.id === l.moduleId)!;
    for (const b of l.blocks) {
      if (b.type !== 'term' || !b.term.trim() || !b.definition.trim()) continue;
      const term = cleanTerm(b.term);
      /* «Компонент» и «Компонент (component)» — один термин */
      const key = fold(term.replace(/\s*\([^)]*\)\s*/g, ' ').trim());
      const def = { text: plain(b.definition), lectureId: l.id, lecture: l.title, moduleId: m.id, module: m.title, moduleNo: no.get(m.id)!, section: m.section, locked: !!m.locked };
      const row = terms.get(key);
      if (!row) {
        /* буква указателя: первая буква термина («Ё» — вместе с «Е»), иначе «#» */
        const letter = (term.match(/[A-Za-zА-Яа-яЁё]/)?.[0] ?? '#').toUpperCase().replace('Ё', 'Е');
        terms.set(key, { term, letter, defs: [def] });
        continue;
      }
      if (term.length > row.term.length) row.term = term;
      /* одинаковое определение в той же теме не повторяем */
      if (!row.defs.some((d) => fold(d.text) === fold(def.text))) row.defs.push(def);
    }
  }
  const list = [...terms.entries()]
    .map(([key, t]) => ({ key, ...t }))
    .sort((a, b) => a.term.localeCompare(b.term, 'ru'));
  const letters = [...new Set(list.map((t) => t.letter))];
  return {
    course: { id: v.id, title: v.title },
    preview: v.preview,
    sections: v.sections.map((s) => s.title),
    letters,
    terms: list,
  };
};

/* ---------- схемы курса ---------- */
/* рисунки лекций с точками-подсказками — лента «Интерактивные схемы» на странице курса */
export const courseFigures = async (ctx: Ctx, courseId: string) => {
  const v = await learnCourse(ctx, courseId);
  const mods = v.sections.flatMap((s) => s.modules);
  const no = new Map(mods.map((m, i) => [m.id, i + 1]));
  const lectures = alive(await ctx.repo.list('lectures', 'moduleId', mods.map((m) => m.id))).sort(
    (a, b) => no.get(a.moduleId)! - no.get(b.moduleId)! || a.position - b.position,
  );
  const figures: { lectureId: string; lecture: string; block: number; moduleNo: number; module: string; caption: string; src: string | null; fileId: string | null; points: number; locked: boolean }[] = [];
  for (const l of lectures) {
    const m = mods.find((x) => x.id === l.moduleId)!;
    l.blocks.forEach((b, i) => {
      if (b.type !== 'image' || !b.points?.length) return;
      figures.push({ lectureId: l.id, lecture: l.title, block: i, moduleNo: no.get(m.id)!, module: m.title, caption: b.caption, src: b.src ?? null, fileId: b.src ? null : b.fileId, points: b.points.length, locked: !!m.locked });
    });
  }
  return { course: { id: v.id, title: v.title }, figures };
};
