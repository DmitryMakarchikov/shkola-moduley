/* демонстрационные данные: заполняют пустое хранилище при первом запуске */
import type { Base, Block, Lab, Lecture, Module, Question, Role, Section, Test, TestSettings, User } from './model.ts';
import type { Ports } from './ports.ts';
import type { DEdge, DNode, Diagram } from './diagram.ts';
import { joinCode } from './context.ts';
import { seeded } from './grading.ts';

/* эталонные диаграммы для варианта 1 «Электронная библиотека колледжа» */
const n = (id: string, type: string, name: string, x: number, y: number, extra: Partial<DNode> = {}): DNode => ({ id, type, name, x, y, ...extra });
const e = (id: string, type: string, from: string, to: string): DEdge => ({ id, type, from, to });
const SEED_DIAGRAMS: Record<number, Diagram> = {
  2: {
    kind: 'usecase',
    nodes: [
      n('b', 'boundary', 'Электронная библиотека', 300, 40, { w: 620, h: 600 }),
      n('a1', 'actor', 'Читатель', 140, 200),
      n('a2', 'actor', 'Библиотекарь', 140, 500),
      n('u1', 'usecase', 'Найти книгу', 470, 130),
      n('u2', 'usecase', 'Забронировать книгу', 470, 260),
      n('u3', 'usecase', 'Войти в систему', 760, 330),
      n('u4', 'usecase', 'Выдать книгу', 470, 420),
      n('u5', 'usecase', 'Принять книгу', 470, 560),
    ],
    edges: [e('e1', 'association', 'a1', 'u1'), e('e2', 'association', 'a1', 'u2'), e('e3', 'association', 'a2', 'u4'), e('e4', 'association', 'a2', 'u5'), e('e5', 'include', 'u2', 'u3'), e('e6', 'include', 'u4', 'u3')],
  },
  3: {
    kind: 'class',
    nodes: [
      n('c1', 'class', 'Библиотека', 120, 80, { attrs: ['название: строка', 'адрес: строка'].join('\n'), ops: 'найтиКнигу(запрос)' }),
      n('c2', 'class', 'Книга', 470, 80, { attrs: ['название: строка', 'автор: строка', 'год: число'].join('\n') }),
      n('c3', 'class', 'Экземпляр', 470, 360, { attrs: ['инвентарныйНомер: строка', 'доступен: логический'].join('\n') }),
      n('c4', 'class', 'Выдача', 820, 360, { attrs: ['дата: дата', 'срок: дата'].join('\n'), ops: 'продлить(дни)' }),
      n('c5', 'class', 'Читатель', 820, 80, { attrs: ['ФИО: строка', 'номерБилета: строка'].join('\n') }),
    ],
    edges: [e('r1', 'aggregation', 'c1', 'c2'), e('r2', 'composition', 'c2', 'c3'), e('r3', 'association', 'c4', 'c3'), e('r4', 'association', 'c4', 'c5')],
  },
};

/* пакет курса: материалы преподавателя после импорта (tools/import_course.py) */
export interface CoursePackage {
  title: string;
  description: string;
  sections: {
    title: string;
    modules: {
      title: string;
      hours: number;
      goal: string;
      tasks: string[];
      outcomes: string[];
      lectures: { title: string; blocks: Block[] }[];
      tests: { title: string; settings: TestSettings; questions: Question[] }[];
      labs: { title: string; goal: string; description: string; blocks: Block[]; questions: string[]; variants: string[]; criteria: string[]; diagramKind?: string | null }[];
    }[];
  }[];
}

/* практикумы с эталоном: показывают автосравнение диаграммы учащегося с эталоном преподавателя */
const PRACTICUM = [
  {
    module: 'Диаграмма вариантов использования',
    title: 'Практикум: диаграмма прецедентов «Электронная библиотека»',
    goal: 'Научиться выделять актёров и прецеденты и связывать их по нотации UML.',
    description: 'Постройте во встроенном конструкторе диаграмму вариантов использования системы «Электронная библиотека». Читатель ищет и бронирует книги, библиотекарь выдаёт и принимает книги. Для бронирования и выдачи нужен вход в систему. Нажмите «Проверить»: система покажет ошибки нотации и процент совпадения с эталоном, не раскрывая ответ.',
    blocks: [] as Block[],
    questions: [] as string[],
    variants: [] as string[],
    criteria: ['все актёры и прецеденты на месте', 'связи соответствуют нотации UML', 'использованы отношения «include»'],
    diagramKind: 'usecase',
    reference: SEED_DIAGRAMS[2],
  },
  {
    module: 'Диаграмма классов',
    title: 'Практикум: диаграмма классов «Библиотека»',
    goal: 'Научиться выделять классы, атрибуты и виды связей между ними.',
    description: 'Постройте диаграмму классов: библиотека хранит книги (агрегация); у книги есть экземпляры, которые без книги не существуют (композиция); выдача связывает экземпляр книги и читателя. Укажите атрибуты классов. Нажмите «Проверить», чтобы сравнить диаграмму с эталоном.',
    blocks: [] as Block[],
    questions: [] as string[],
    variants: [] as string[],
    criteria: ['выделены все классы', 'верно выбраны виды связей', 'указаны атрибуты'],
    diagramKind: 'class',
    reference: SEED_DIAGRAMS[3],
  },
];

export const DEMO_PASSWORD = 'demo2026';

export const DEMO_ACCOUNTS: { login: string; role: Role; name: string }[] = [
  { login: 'admin', role: 'owner', name: 'Ковалёв Андрей Сергеевич' },
  { login: 'director', role: 'director', name: 'Савицкая Елена Викторовна' },
  { login: 'zamdir', role: 'director', name: 'Мельник Олег Петрович' },
  { login: 'metodist', role: 'methodist', name: 'Лукашевич Ирина Николаевна' },
  { login: 'teacher', role: 'teacher', name: 'Воронович Сергей Александрович' },
  { login: 'teacher2', role: 'teacher', name: 'Климович Наталья Ивановна' },
  { login: 'student', role: 'student', name: 'Андреев Илья Викторович' },
];

const STUDENTS_46 = [
  'Андреев Илья Викторович',
  'Бондарь Мария Сергеевна',
  'Гончарова Анна Игоревна',
  'Жук Дмитрий Олегович',
  'Кравец Алексей Павлович',
  'Лис Валерия Андреевна',
  'Шевчук Егор Николаевич',
  'Тарасевич Полина Дмитриевна',
];
const STUDENTS_47 = [
  'Ракович Артём Юрьевич',
  'Сенько Ксения Михайловна',
  'Бурак Денис Олегович',
  'Гайдук Алина Сергеевна',
  'Зенькович Максим Игоревич',
  'Ковалевич Дарья Андреевна',
  'Мартинович Никита Павлович',
  'Шидловская Вероника Олеговна',
];
const STUDENTS_48 = [
  'Адамович Кирилл Дмитриевич',
  'Бельская Яна Викторовна',
  'Гурин Матвей Александрович',
  'Жданович Полина Сергеевна',
  'Котович Егор Иванович',
  'Лапицкая Алеся Николаевна',
  'Пашкевич Илья Андреевич',
];

const LOGINS: Record<string, string> = {
  'Андреев Илья Викторович': 'student',
  'Бондарь Мария Сергеевна': 'student2',
};

/* ---------- учебный контент-образец ---------- */
const lecture1: Block[] = [
  { type: 'text', text: 'UML (Unified Modeling Language) — унифицированный язык визуального моделирования программных систем. Он стандартизирован консорциумом OMG и позволяет описать систему с разных сторон: что она делает, из чего состоит и как ведёт себя во времени.' },
  { type: 'heading', text: 'Зачем нужны модели' },
  { type: 'list', ordered: false, items: ['договориться с заказчиком о требованиях до написания кода', 'увидеть архитектуру целиком и найти ошибки на бумаге, а не в программе', 'передать знания новым участникам команды'] },
  { type: 'heading', text: 'Виды диаграмм UML' },
  { type: 'table', rows: [['Группа', 'Диаграммы'], ['Структурные', 'классов, объектов, компонентов, развёртывания, пакетов'], ['Поведенческие', 'вариантов использования, деятельности, состояний'], ['Взаимодействия', 'последовательности, коммуникации']] },
  { type: 'note', tone: 'info', text: 'Модель — это не рисунок ради рисунка. Каждая диаграмма отвечает на свой вопрос: «кто и что делает с системой», «из каких частей она состоит», «в каком порядке выполняются действия».' },
  { type: 'term', term: 'Модель', definition: 'Упрощённое описание системы, которое показывает существенные для решаемой задачи свойства.' },
];

const lecture2: Block[] = [
  { type: 'text', text: 'Диаграмма вариантов использования (прецедентов) описывает функциональные требования к системе: кто с ней работает и какие цели при этом достигает. Её строят на этапе анализа требований, до проектирования.' },
  { type: 'heading', text: 'Элементы диаграммы' },
  { type: 'list', ordered: false, items: ['актёр — роль внешнего пользователя или внешней системы; изображается фигуркой человека', 'вариант использования (прецедент) — законченное действие, дающее актёру результат; изображается эллипсом, название — глагол с существительным: «Оформить заказ»', 'граница системы — прямоугольник с названием системы; прецеденты внутри, актёры снаружи', 'ассоциация — линия между актёром и прецедентом'] },
  { type: 'heading', text: 'Отношения между прецедентами' },
  { type: 'table', rows: [['Отношение', 'Смысл', 'Обозначение'], ['«include»', 'базовый прецедент всегда включает другой', 'пунктирная стрелка от базового к включаемому'], ['«extend»', 'необязательное расширение при условии', 'пунктирная стрелка от расширяющего к базовому'], ['обобщение', 'частный случай общего', 'сплошная линия с полым треугольником у общего']] },
  { type: 'note', tone: 'warn', text: 'Типичная ошибка — превращать диаграмму в блок-схему. Диаграмма вариантов использования не показывает порядок действий, только цели пользователей.' },
  { type: 'term', term: 'Актёр', definition: 'Роль, которую играет пользователь или внешняя система при взаимодействии с разрабатываемой системой.' },
  { type: 'term', term: 'Прецедент', definition: 'Последовательность действий системы, дающая актёру значимый для него результат.' },
];

const lecture3: Block[] = [
  { type: 'text', text: 'Диаграмма классов показывает статическую структуру системы: классы, их атрибуты и операции, а также связи между классами. По ней пишется код и проектируется база данных.' },
  { type: 'heading', text: 'Класс' },
  { type: 'text', text: 'Класс изображается прямоугольником из трёх частей: имя, атрибуты, операции. Видимость обозначается знаками: «+» — открытый, «−» — закрытый, «#» — защищённый.' },
  { type: 'code', lang: 'text', text: 'Книга\n— isbn: String\n— название: String\n+ выдать(читатель: Читатель): void' },
  { type: 'heading', text: 'Связи' },
  { type: 'list', ordered: false, items: ['ассоциация — объекты классов связаны между собой, у концов указывается кратность: 1, 0..1, *, 1..*', 'агрегация — «часть — целое», часть может существовать отдельно; полый ромб у целого', 'композиция — часть не существует без целого; закрашенный ромб у целого', 'обобщение — наследование; полый треугольник у родителя'] },
  { type: 'term', term: 'Кратность', definition: 'Число объектов одного класса, которые могут быть связаны с одним объектом другого класса.' },
];

const q = (id: string, type: Question['type'], text: string, extra: Partial<Question>): Question => ({
  id,
  type,
  text,
  options: [],
  pairs: [],
  answer: [],
  explain: '',
  points: 1,
  ...extra,
});

const test1: Question[] = [
  q('q1', 'single', 'Что такое UML?', { options: ['Язык программирования', 'Унифицированный язык визуального моделирования', 'Система управления базами данных', 'Среда разработки'], answer: [1], explain: 'UML — язык моделирования, а не программирования.' }),
  q('q2', 'multi', 'Какие диаграммы относятся к структурным?', { options: ['Классов', 'Последовательности', 'Компонентов', 'Деятельности', 'Развёртывания'], answer: [0, 2, 4], explain: 'Структурные диаграммы описывают, из чего состоит система.' }),
  q('q3', 'match', 'Сопоставьте вопрос и диаграмму, которая на него отвечает.', { options: ['Кто и что делает с системой?', 'Из каких классов состоит система?', 'В каком порядке объекты обмениваются сообщениями?'], pairs: ['Вариантов использования', 'Классов', 'Последовательности'] }),
  q('q4', 'short', 'Как называется консорциум, который стандартизирует UML (аббревиатура)?', { answer: ['OMG', 'Object Management Group'], explain: 'Object Management Group.' }),
  q('q5', 'order', 'Расположите этапы разработки в правильном порядке.', { options: ['Анализ требований', 'Проектирование', 'Кодирование', 'Тестирование', 'Внедрение'] }),
];

const test2: Question[] = [
  q('q1', 'single', 'Как на диаграмме вариантов использования изображается прецедент?', { options: ['Прямоугольником', 'Эллипсом', 'Ромбом', 'Фигуркой человека'], answer: [1], explain: 'Фигуркой изображается актёр, эллипсом — прецедент.' }),
  q('q2', 'multi', 'Кто может быть актёром?', { options: ['Читатель библиотеки', 'Платёжная система ЕРИП', 'Кнопка «Войти»', 'Таблица базы данных системы'], answer: [0, 1], explain: 'Актёр — внешняя роль: человек или внешняя система. Элементы интерфейса и части самой системы актёрами не являются.' }),
  q('q3', 'match', 'Сопоставьте отношение и его обозначение.', { options: ['Ассоциация', '«include»', '«extend»', 'Обобщение'], pairs: ['Сплошная линия', 'Пунктирная стрелка от базового к включаемому', 'Пунктирная стрелка от расширяющего к базовому', 'Линия с полым треугольником у общего'] }),
  q('q4', 'order', 'Расположите шаги построения диаграммы.', { options: ['Определить границу системы', 'Найти актёров', 'Определить прецеденты для каждого актёра', 'Связать актёров и прецеденты', 'Выделить отношения include и extend'] }),
  q('q5', 'short', 'Какое ключевое слово ставят над стрелкой обязательного включения?', { answer: ['include', '«include»'], explain: 'Обязательное включение обозначается «include».' }),
  q('q6', 'single', 'Прецедент «Применить промокод» выполняется, только если у покупателя есть промокод. Как он связан с «Оформить заказ»?', { options: ['Ассоциация', '«include»', '«extend»', 'Обобщение'], answer: [2], explain: 'Необязательное поведение при условии — расширение «extend».' }),
];

const test3: Question[] = [
  q('q1', 'single', 'Из скольких частей состоит обозначение класса?', { options: ['Из одной', 'Из двух', 'Из трёх', 'Из четырёх'], answer: [2], explain: 'Имя, атрибуты, операции.' }),
  q('q2', 'match', 'Сопоставьте знак видимости и его смысл.', { options: ['+', '−', '#'], pairs: ['Открытый', 'Закрытый', 'Защищённый'] }),
  q('q3', 'single', 'Часть не может существовать без целого. Какое это отношение?', { options: ['Ассоциация', 'Агрегация', 'Композиция', 'Зависимость'], answer: [2], explain: 'Композиция — сильная форма «часть — целое».' }),
  q('q4', 'short', 'Как записывается кратность «один или больше»?', { answer: ['1..*'], explain: '1..* — не меньше одного.' }),
  q('q5', 'multi', 'Что изображается на диаграмме классов?', { options: ['Атрибуты', 'Операции', 'Порядок вызова методов во времени', 'Связи между классами'], answer: [0, 1, 3], explain: 'Порядок во времени показывает диаграмма последовательности.' }),
];

/* ---------- заполнение ---------- */
export const seedDemo = async (ports: Ports, pkg?: CoursePackage) => {
  if ((await ports.repo.all('institutions')).length) return false;
  const t0 = ports.now();
  const at = (days: number) => new Date(t0.getTime() + days * 86_400_000).toISOString();
  const mk = (days = 0): Base => ({ id: ports.id(), createdAt: at(days), updatedAt: at(days), deletedAt: null, deletedBy: null });
  const hash = await ports.hasher.hash(DEMO_PASSWORD);

  await ports.repo.tx(async (repo) => {
    const inst = { ...mk(-30), name: 'Учреждение образования «Открытый учебный центр»', shortName: 'Открытый учебный центр', city: 'Минск' };
    await repo.insert('institutions', inst);
    const depIt = { ...mk(-30), institutionId: inst.id, name: 'Информационное отделение' };
    const depDz = { ...mk(-30), institutionId: inst.id, name: 'Отделение дизайна' };
    await repo.insert('departments', depIt);
    await repo.insert('departments', depDz);

    const person = async (name: string, role: Role, login: string, institutionId: string | null) => {
      const [lastName = '', firstName = '', middleName = ''] = name.split(' ');
      const u: User = {
        ...mk(-29),
        institutionId,
        role,
        login,
        lastName,
        firstName,
        middleName,
        email: '',
        passwordHash: hash,
        status: 'active',
        mustChangePassword: false,
        lastLoginAt: null,
        failedLogins: 0,
        lockedUntil: null,
      };
      await repo.insert('users', u);
      return u;
    };

    const staff: Record<string, User> = {};
    for (const a of DEMO_ACCOUNTS.filter((x) => x.role !== 'student')) {
      staff[a.login] = await person(a.name, a.role, a.login, a.role === 'owner' ? null : inst.id);
    }
    const teacher = staff.teacher!;

    const g46 = { ...mk(-28), institutionId: inst.id, departmentId: depIt.id, name: 'ПО-31', year: 3, specialty: 'Разработка и сопровождение программного обеспечения', curatorId: teacher.id, joinCode: joinCode() };
    const g47 = { ...mk(-28), institutionId: inst.id, departmentId: depIt.id, name: 'ПО-32', year: 3, specialty: 'Разработка и сопровождение программного обеспечения', curatorId: staff.teacher2!.id, joinCode: joinCode() };
    const g48 = { ...mk(-28), institutionId: inst.id, departmentId: depIt.id, name: 'ПО-33', year: 3, specialty: 'Разработка и сопровождение программного обеспечения', curatorId: staff.teacher2!.id, joinCode: joinCode() };
    await repo.insert('groups', g46);
    await repo.insert('groups', g47);
    await repo.insert('groups', g48);

    const students: User[] = [];
    let n = 3;
    for (const name of STUDENTS_46) {
      const s = await person(name, 'student', LOGINS[name] ?? `student${n++}`, inst.id);
      students.push(s);
      await repo.insert('groupMembers', { ...mk(-27), groupId: g46.id, studentId: s.id });
    }
    const roster = new Map<string, User[]>([[g46.id, students], [g47.id, []], [g48.id, []]]);
    for (const [g, names] of [[g47, STUDENTS_47], [g48, STUDENTS_48]] as const) {
      for (const name of names) {
        const s = await person(name, 'student', `student${n++}`, inst.id);
        roster.get(g.id)!.push(s);
        await repo.insert('groupMembers', { ...mk(-27), groupId: g.id, studentId: s.id });
      }
    }

    const disc = { ...mk(-26), institutionId: inst.id, name: 'Технология разработки программного обеспечения', code: 'ТРПО' };
    await repo.insert('disciplines', disc);

    const labs: Lab[] = [];
    const tests: Test[] = [];
    const lectures: Lecture[] = [];
    let course;
    if (pkg) {
      /* полный курс из материалов преподавателя */
      course = { ...mk(-25), institutionId: inst.id, disciplineId: disc.id, authorId: teacher.id, title: pkg.title, description: pkg.description, status: 'published' as const, reviewComment: '' };
      await repo.insert('courses', course);
      let sp = 1;
      let mp = 1;
      for (const sec of pkg.sections) {
        const section: Section = { ...mk(-25), courseId: course.id, title: sec.title, position: sp++ };
        await repo.insert('sections', section);
        for (const m of sec.modules) {
          const mod: Module = { ...mk(-24), courseId: course.id, sectionId: section.id, title: m.title, position: mp++, goal: m.goal, tasks: m.tasks, outcomes: m.outcomes, hours: m.hours || 2 };
          await repo.insert('modules', mod);
          let ip = 1;
          for (const l of m.lectures) {
            const lec: Lecture = { ...mk(-24), moduleId: mod.id, title: l.title, position: ip++, blocks: l.blocks };
            await repo.insert('lectures', lec);
            lectures.push(lec);
          }
          ip = 1;
          for (const t of m.tests) {
            const tst: Test = { ...mk(-24), moduleId: mod.id, title: t.title, position: ip++, settings: t.settings, questions: t.questions };
            await repo.insert('tests', tst);
            tests.push(tst);
          }
          ip = 1;
          const extra = PRACTICUM.filter((x) => m.title.startsWith(x.module));
          for (const l of [...m.labs, ...extra]) {
            const lab: Lab = {
              ...mk(-24),
              moduleId: mod.id,
              title: l.title,
              position: ip++,
              goal: l.goal,
              description: l.description,
              variants: l.variants,
              criteria: l.criteria,
              templateFileIds: [],
              maxScore: 10,
              allowFiles: true,
              diagramKind: l.diagramKind ?? null,
              diagramReference: 'reference' in l ? [l.reference] : null,
              blocks: l.blocks,
              controlQuestions: l.questions,
            };
            await repo.insert('labs', lab);
            labs.push(lab);
          }
        }
      }
    } else {
      course = { ...mk(-25), institutionId: inst.id, disciplineId: disc.id, authorId: teacher.id, title: 'ТРПО: моделирование программных систем на языке UML', description: 'Раздел учебной программы, посвящённый объектному моделированию. Каждый модуль — тема: лекция, тест для самопроверки и лабораторная работа.', status: 'published' as const, reviewComment: '' };
      await repo.insert('courses', course);
      const section: Section = { ...mk(-25), courseId: course.id, title: 'Объектно-ориентированное моделирование на языке UML', position: 1 };
      await repo.insert('sections', section);

      const plan = [
        { title: 'Язык UML и его диаграммы', goal: 'Сформировать представление о назначении языка UML и видах его диаграмм.', outcomes: ['понимаю, зачем разработчики строят модели', 'различаю структурные и поведенческие диаграммы', 'могу выбрать диаграмму под задачу'], lecture: lecture1, test: test1, lab: { title: 'Лабораторная работа № 1. Выбор диаграмм для проекта', goal: 'Научиться подбирать виды диаграмм UML для описания системы.', description: 'Для своей учебной системы составьте таблицу: какие диаграммы UML вы построите, на какой вопрос отвечает каждая из них и на каком этапе разработки она нужна.', variants: ['Электронная библиотека колледжа', 'Запись в поликлинику', 'Грузоперевозки', 'Интернет-магазин'] } },
        { title: 'Диаграмма вариантов использования', goal: 'Научить описывать функциональные требования диаграммой вариантов использования.', outcomes: ['умею находить актёров и прецеденты в тексте требований', 'правильно изображаю границу системы и связи', 'различаю «include», «extend» и обобщение'], lecture: lecture2, test: test2, lab: { title: 'Лабораторная работа № 2. Диаграмма вариантов использования', goal: 'Построить диаграмму вариантов использования для проектируемой системы.', description: 'Определите актёров и прецеденты своей системы, постройте диаграмму вариантов использования, опишите каждого актёра и его прецеденты. Сдайте отчёт и файл диаграммы.', variants: ['Электронная библиотека колледжа', 'Запись в поликлинику', 'Грузоперевозки', 'Интернет-магазин'], diagramKind: 'usecase' } },
        { title: 'Диаграмма классов', goal: 'Научить проектировать статическую структуру системы диаграммой классов.', outcomes: ['умею выделять классы, атрибуты и операции', 'различаю ассоциацию, агрегацию, композицию и обобщение', 'правильно указываю кратности'], lecture: lecture3, test: test3, lab: { title: 'Лабораторная работа № 3. Диаграмма классов', goal: 'Построить диаграмму классов предметной области.', description: 'Выделите классы своей системы, укажите атрибуты с типами и операции, проведите связи с кратностями. Сдайте отчёт и файл диаграммы.', variants: ['Электронная библиотека колледжа', 'Запись в поликлинику', 'Грузоперевозки', 'Интернет-магазин'], diagramKind: 'class' } },
      ];

      let pos = 1;
      for (const item of plan) {
        const mod: Module = { ...mk(-24), courseId: course.id, sectionId: section.id, title: item.title, position: pos++, goal: item.goal, tasks: [], outcomes: item.outcomes, hours: 2 };
        await repo.insert('modules', mod);
        const lec: Lecture = { ...mk(-24), moduleId: mod.id, title: item.title, position: 1, blocks: item.lecture };
        const tst: Test = { ...mk(-24), moduleId: mod.id, title: `Проверь себя: ${item.title[0]!.toLowerCase()}${item.title.slice(1)}`, position: 1, settings: { timeLimitMin: 0, attempts: 0, shuffle: true, passPercent: 60, mode: 'self' }, questions: item.test };
        const lab: Lab = { ...mk(-24), moduleId: mod.id, position: 1, criteria: ['диаграмма соответствует варианту', 'нотация UML соблюдена', 'отчёт оформлен по требованиям'], templateFileIds: [], maxScore: 10, allowFiles: true, diagramKind: null, diagramReference: null, ...item.lab };
        await repo.insert('lectures', lec);
        await repo.insert('tests', tst);
        const ref = SEED_DIAGRAMS[mod.position];
        if (ref) Object.assign(lab, { diagramKind: ref.kind, diagramReference: [ref] });
        await repo.insert('labs', lab);
        lectures.push(lec);
        tests.push(tst);
        labs.push(lab);
      }
    }
    /* какие работы участвуют в демонстрационной истории */
    const byNo = (no: number) => labs.find((l) => l.title.startsWith(`Лабораторная работа № ${no}.`));
    const hist = pkg ? [byNo(1) ?? labs[0]!, byNo(13) ?? labs[1]!, byNo(2) ?? labs[2]!] : [labs[0]!, labs[1]!, labs[2]!];
    const firstTest = tests.find((t) => !t.settings.draft) ?? tests[0]!;
    /* сроки по неделям: тесты и лабораторные k-го модуля сдаются через k+1 недель от начала (шесть недель назад) */
    const mods = (await repo.all('modules')).filter((m) => m.courseId === course.id).sort((a, b) => a.position - b.position);
    const weekly: Record<string, string> = {};
    const timed = mods.filter((m) => tests.some((t) => t.moduleId === m.id && !t.settings.draft) || labs.some((l) => l.moduleId === m.id));
    timed.slice(0, 14).forEach((m, k) => {
      for (const x of [...tests.filter((t) => t.moduleId === m.id && !t.settings.draft), ...labs.filter((l) => l.moduleId === m.id)]) weekly[x.id] = at(-42 + 7 * (k + 1));
    });
    const own: Record<string, string> = { ...weekly, [hist[0]!.id]: at(-5), [hist[1]!.id]: at(5), [hist[2]!.id]: at(12) };
    const assignment = { ...mk(-42), courseId: course.id, groupId: g46.id, teacherId: teacher.id, dueDates: own };
    await repo.insert('assignments', assignment);
    const asg47 = { ...mk(-42), courseId: course.id, groupId: g47.id, teacherId: staff.teacher2!.id, dueDates: weekly };
    const asg48 = { ...mk(-40), courseId: course.id, groupId: g48.id, teacherId: teacher.id, dueDates: weekly };
    await repo.insert('assignments', asg47);
    await repo.insert('assignments', asg48);

    /* немного истории, чтобы журнал и очередь проверки не были пустыми */
    const [s1, s2, s3] = students;
    for (const s of [s1!, s2!, s3!]) {
      for (const l of lectures.slice(0, 2)) await repo.insert('lectureViews', { ...mk(-10), lectureId: l.id, userId: s.id });
      await repo.insert('attempts', { ...mk(-9), testId: firstTest.id, studentId: s.id, answers: {}, score: 4, maxScore: 5, percent: 80, details: [] });
    }
    await repo.insert('submissions', { ...mk(-6), labId: hist[0]!.id, studentId: s2!.id, assignmentId: assignment.id, version: 1, fileIds: [], comment: 'Таблица выбора диаграмм для системы «Запись в поликлинику».', diagram: null, autoScore: null, status: 'graded', grade: 9, teacherComment: 'Хорошо обосновали выбор. Добавьте диаграмму развёртывания.', gradedBy: teacher.id, gradedAt: at(-4), late: false });
    await repo.insert('submissions', { ...mk(-1), labId: hist[1]!.id, studentId: s1!.id, assignmentId: assignment.id, version: 1, fileIds: [], comment: 'Диаграмма вариантов использования для электронной библиотеки. Актёры: Читатель, Библиотекарь.', diagram: null, autoScore: null, status: 'submitted', grade: null, teacherComment: '', gradedBy: null, gradedAt: null, late: false });
    await repo.insert('submissions', { ...mk(-2), labId: hist[0]!.id, studentId: s3!.id, assignmentId: assignment.id, version: 1, fileIds: [], comment: 'Выбор диаграмм для интернет-магазина.', diagram: null, autoScore: null, status: 'returned', grade: null, teacherComment: 'Не указано, на каком этапе нужна каждая диаграмма. Дополните таблицу.', gradedBy: teacher.id, gradedAt: at(-1), late: true });

    /* учебная история групп за шесть недель: у каждой группы свой уровень, у учащегося — свой разброс.
       Случайность повторяемая (одно зерно); демонстрационный учащийся остаётся «только начавшим» */
    const rnd = seeded('demo-activity-2026');
    const LEVEL: Record<string, number> = { [g46.id]: 0.8, [g47.id]: 0.52, [g48.id]: 0.68 };
    const ASG: Record<string, string> = { [g46.id]: assignment.id, [g47.id]: asg47.id, [g48.id]: asg48.id };
    const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
    const nowMs = t0.getTime();
    /* дата не позже «сейчас»: работа над текущим модулем разбросана по последним дням */
    const shift = (iso: string, days: number) => {
      const t = new Date(iso).getTime() + days * 86_400_000;
      return new Date(t < nowMs - 3_600_000 ? t : nowMs - (6 + rnd() * 100) * 3_600_000);
    };
    const row = (d: Date): Base => ({ id: ports.id(), createdAt: d.toISOString(), updatedAt: d.toISOString(), deletedAt: null, deletedBy: null });
    const story = new Set([`${s2!.id}:${hist[0]!.id}`, `${s3!.id}:${hist[0]!.id}`, `${s1!.id}:${hist[1]!.id}`, `${s2!.id}:${firstTest.id}`, `${s3!.id}:${firstTest.id}`]);
    for (const [gid, list] of roster) {
      for (const s of list) {
        if (s.id === s1!.id) continue;
        const skill = clamp(LEVEL[gid]! + (rnd() - 0.55) * 0.5, 0.12, 0.98);
        for (const [k, m] of timed.slice(0, 7).entries()) {
          const due = at(-42 + 7 * (k + 1));
          if (new Date(due).getTime() > nowMs + 2 * 86_400_000 && skill < 0.85) continue;
          for (const l of lectures.filter((x) => x.moduleId === m.id)) {
            if (rnd() < 0.5 + 0.45 * skill) await repo.insert('lectureViews', { ...row(shift(due, -1 - Math.floor(rnd() * 5))), lectureId: l.id, userId: s.id });
          }
          for (const t of tests.filter((x) => x.moduleId === m.id && !x.settings.draft)) {
            if (story.has(`${s.id}:${t.id}`) || rnd() > 0.4 + 0.58 * skill) continue;
            const max = t.questions.length || 5;
            let percent = Math.round(clamp(40 + 58 * skill + (rnd() - 0.6) * 40, 10, 100));
            const when = shift(due, rnd() < 0.18 * (1 - skill) ? 1 + Math.floor(rnd() * 4) : -Math.floor(rnd() * 5));
            await repo.insert('attempts', { ...row(when), testId: t.id, studentId: s.id, answers: {}, score: Math.round((percent / 100) * max), maxScore: max, percent, details: [] });
            if (percent < t.settings.passPercent && rnd() < skill) {
              percent = Math.min(100, percent + 15 + Math.floor(rnd() * 25));
              await repo.insert('attempts', { ...row(shift(when.toISOString(), 1)), testId: t.id, studentId: s.id, answers: {}, score: Math.round((percent / 100) * max), maxScore: max, percent, details: [] });
            }
          }
          for (const l of labs.filter((x) => x.moduleId === m.id)) {
            const d = gid === g46.id ? own[l.id] : weekly[l.id];
            if (!d || story.has(`${s.id}:${l.id}`) || rnd() > 0.3 + 0.68 * skill) continue;
            const when = shift(d, rnd() < 0.25 * (1 - skill) ? 1 + Math.floor(rnd() * 6) : -Math.floor(rnd() * 6));
            const fresh = nowMs - when.getTime() < 3 * 86_400_000;
            const grade = Math.round(clamp(3 + 7 * skill + (rnd() - 0.5) * 3, 2, 10));
            const status = fresh ? 'submitted' : grade < 4 ? 'returned' : 'graded';
            await repo.insert('submissions', {
              ...row(when),
              labId: l.id,
              studentId: s.id,
              assignmentId: ASG[gid]!,
              version: 1,
              fileIds: [],
              comment: 'Отчёт по работе во вложении.',
              diagram: null,
              autoScore: null,
              status,
              grade: status === 'graded' ? grade : null,
              teacherComment: status === 'returned' ? 'Не выполнены пункты задания, оформите отчёт по требованиям.' : status === 'graded' ? (grade >= 9 ? 'Отличная работа.' : 'Работа выполнена, есть замечания по оформлению.') : '',
              gradedBy: status === 'submitted' ? null : gid === g47.id ? staff.teacher2!.id : teacher.id,
              gradedAt: status === 'submitted' ? null : shift(when.toISOString(), 2).toISOString(),
              late: new Date(d) < when,
            });
          }
        }
      }
    }

    await repo.insert('notifications', { ...mk(-1), userId: teacher.id, title: 'Сдана лабораторная работа', text: `${s1!.lastName} ${s1!.firstName}: «${hist[1]!.title}»`, link: '/review', readAt: null });
    await repo.insert('notifications', { ...mk(-4), userId: s2!.id, title: 'Работа проверена', text: `«${hist[0]!.title}»: отметка 9`, link: `/learn/lab/${hist[0]!.id}`, readAt: null });
    await repo.insert('audit', { ...mk(-25), institutionId: inst.id, actorId: teacher.id, action: 'create', entity: 'courses', entityId: course.id, summary: `Курс «${course.title}»` });
    await repo.insert('audit', { ...mk(-24), institutionId: inst.id, actorId: staff.metodist!.id, action: 'status', entity: 'courses', entityId: course.id, summary: `Курс «${course.title}»: опубликован` });
  });
  return true;
};
