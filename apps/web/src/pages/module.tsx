/* модуль: лекции, тесты, лабораторные — и их редакторы */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { buildCrossword, DIAGRAM_KINDS, DIAGRAM_SPEC, liveQuestions, type Block, type Diagram, type FigurePoint, type Lab, type Lecture, type Module, type Question, type QuestionType, type Test, type TestSettings } from '@pc/core';
import { Blocks, Crossword, FileLink, useFileUrl } from '../components/Blocks.tsx';
import { DiagramEditor, emptyDiagram } from '../components/Diagram.tsx';
import { useApp } from '../lib/app.tsx';
import { useAction, useLoad } from '../lib/hooks.ts';
import { buildModulePackage } from '../lib/scorm.ts';
import { Async, Badge, Button, Empty, Field, Icon, Modal, PageHead, Tabs } from '../ui/ui.tsx';
import { LiveStart } from './live.tsx';

/* «Скачать модуль»: пакет HTML5 / SCORM 1.2 для работы без платформы и для СДО */
const ExportModule = ({ m }: { m: ModFull }) => {
  const { client, toast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      icon="package"
      busy={busy}
      title="Пакет HTML5 / SCORM 1.2: модуль открывается без интернета и загружается в систему дистанционного обучения"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await buildModulePackage(client, m, m.position);
          const url = URL.createObjectURL(r.blob);
          const a = Object.assign(document.createElement('a'), { href: url, download: r.name });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          toast(`Пакет модуля готов: ${r.images} файлов, ${r.questions} заданий для самопроверки`);
        } catch (e) {
          toast((e as Error).message, 'err');
        } finally {
          setBusy(false);
        }
      }}
    >
      Скачать модуль (HTML5 / SCORM)
    </Button>
  );
};

type Kind = 'lectures' | 'tests' | 'labs';
const KIND: Record<Kind, { one: string; icon: string; empty: string }> = {
  lectures: { one: 'Лекция', icon: 'lecture', empty: 'Добавьте лекцию: текст, схемы, примеры, термины.' },
  tests: { one: 'Тест', icon: 'test', empty: 'Добавьте тест для самопроверки: 5–10 заданий разных типов.' },
  labs: { one: 'Лабораторная работа', icon: 'lab', empty: 'Добавьте лабораторную: задание, варианты, критерии, файлы-шаблоны.' },
};

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

interface ModFull extends Module {
  course: { id: string; title: string; status: string };
  lectures: Lecture[];
  tests: Test[];
  labs: Lab[];
  canEdit: boolean;
}

export const ModulePage = () => {
  const { id = '' } = useParams();
  const { client, confirm } = useApp();
  const nav = useNavigate();
  const mod = useLoad(() => client.call<ModFull>('GET', `/modules/${id}`), [id]);
  const [tab, setTab] = useState<Kind>('lectures');
  const [info, setInfo] = useState<{ title: string; goal: string; tasks: string; outcomes: string; hours: number } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const { busy, run } = useAction();

  return (
    <Async state={mod}>
      {(m) => (
        <>
          <PageHead kicker={m.course.title} title={m.title} back={<Link to={`/courses/${m.course.id}`} className="back"><Icon name="arrow-left" size={16} /> Курс</Link>}>
            <ExportModule m={m} />
            {m.canEdit && (
              <Button icon="edit" onClick={() => setInfo({ title: m.title, goal: m.goal, tasks: m.tasks.join('\n'), outcomes: m.outcomes.join('\n'), hours: m.hours })}>
                Тема, цель, результаты
              </Button>
            )}
            {m.canEdit && (
              <Button
                kind="danger"
                icon="trash"
                onClick={async () => {
                  if (await confirm({ text: `Удалить модуль «${m.title}»? Он попадёт в корзину.`, ok: 'Удалить', danger: true })) {
                    if (await run(() => client.call('DELETE', `/modules/${m.id}`), 'Модуль в корзине')) nav(`/courses/${m.course.id}`);
                  }
                }}
              />
            )}
          </PageHead>

          {/* введение модуля */}
          <section className="card intro">
            <div>
              <h2 className="card__subtitle">Цель</h2>
              <p>{m.goal || <span className="muted">Не указана</span>}</p>
              {m.tasks.length > 0 && (
                <>
                  <h2 className="card__subtitle">Задачи</h2>
                  <ul className="lb-list">{m.tasks.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </>
              )}
            </div>
            <div>
              <h2 className="card__subtitle">Результаты учащегося</h2>
              {m.outcomes.length ? <ul className="outcomes">{m.outcomes.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="muted">Не указаны. Сформулируйте их от лица учащегося: «понимаю…», «умею…», «могу применить…».</p>}
              <p className="muted">Учебных часов: {m.hours}</p>
            </div>
          </section>

          {/* блоки модуля */}
          <Tabs
            value={tab}
            onChange={setTab}
            items={(['lectures', 'tests', 'labs'] as Kind[]).map((k) => ({ id: k, label: k === 'lectures' ? 'Лекции' : k === 'tests' ? 'Тесты' : 'Лабораторные', count: m[k].length, icon: KIND[k].icon }))}
          />
          <section className="section">
            {m.canEdit && (
              <div className="section__bar">
                <Button kind="primary" icon="plus" onClick={() => setAdding('')}>
                  {tab === 'lectures' ? 'Новая лекция' : tab === 'tests' ? 'Новый тест' : 'Новая лабораторная'}
                </Button>
              </div>
            )}
            {m[tab].length === 0 ? (
              <Empty title="Пока пусто" text={m.canEdit ? KIND[tab].empty : undefined} />
            ) : (
              <ol className="rows">
                {m[tab].map((it) => (
                  <li key={it.id} className="rows__item">
                    <Link to={`/edit/${tab}/${it.id}`} className="rows__title rows__title--link">
                      {it.title}
                    </Link>
                    {tab === 'tests' && (
                      <Link to={`/tests/${it.id}/stats`} className="rows__extra" title="Анализ заданий: что усвоено, какие задания переписать">
                        <Icon name="chart" size={16} /> анализ
                      </Link>
                    )}
                    <span className="rows__meta">
                      {tab === 'tests' && `${(it as Test).questions.length} заданий`}
                      {tab === 'tests' && (it as Test).settings.draft && (
                        <>
                          {' '}
                          <Badge tone="warn">черновик</Badge>
                        </>
                      )}
                      {tab === 'lectures' && `${(it as Lecture).blocks.length} блоков`}
                      {tab === 'labs' && `${(it as Lab).variants.length} вариантов`}
                    </span>
                    {m.canEdit && (
                      <span className="rows__actions">
                        <Button size="sm" kind="ghost" icon="up" aria-label="Выше" onClick={async () => (await run(() => client.call('POST', `/${tab}/${it.id}/move`, { direction: 'up' }))) && mod.reload()} />
                        <Button size="sm" kind="ghost" icon="down" aria-label="Ниже" onClick={async () => (await run(() => client.call('POST', `/${tab}/${it.id}/move`, { direction: 'down' }))) && mod.reload()} />
                        <Button
                          size="sm"
                          kind="ghost"
                          icon="trash"
                          aria-label="Удалить"
                          onClick={async () => {
                            if (await confirm({ text: `Удалить «${it.title}»? Можно будет восстановить из корзины.`, ok: 'Удалить', danger: true })) {
                              if (await run(() => client.call('DELETE', `/${tab}/${it.id}`), 'Перемещено в корзину')) mod.reload();
                            }
                          }}
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* создание блока */}
          <Modal
            open={adding !== null}
            onClose={() => setAdding(null)}
            title={`${KIND[tab].one}: название`}
            footer={
              <>
                <Button onClick={() => setAdding(null)}>Отмена</Button>
                <Button
                  kind="primary"
                  busy={busy}
                  onClick={async () => {
                    const body =
                      tab === 'tests'
                        ? { title: adding, questions: [] }
                        : tab === 'lectures'
                          ? { title: adding, blocks: [] }
                          : { title: adding, description: '', allowFiles: true };
                    const r = await run(() => client.call<{ id: string }>('POST', `/modules/${m.id}/${tab}`, body), 'Создано');
                    if (r) nav(`/edit/${tab}/${r.id}`);
                  }}
                >
                  Создать и открыть редактор
                </Button>
              </>
            }
          >
            <Field label="Название">{(fid) => <input id={fid} className="input" value={adding ?? ''} onChange={(e) => setAdding(e.target.value)} autoFocus />}</Field>
          </Modal>

          {/* тема, цель, результаты */}
          <Modal
            open={!!info}
            onClose={() => setInfo(null)}
            title="Тема, цель и результаты"
            wide
            footer={
              <>
                <Button onClick={() => setInfo(null)}>Отмена</Button>
                <Button
                  kind="primary"
                  busy={busy}
                  onClick={async () => {
                    if (!info) return;
                    const ok = await run(() => client.call('PATCH', `/modules/${m.id}`, { title: info.title, goal: info.goal, tasks: lines(info.tasks), outcomes: lines(info.outcomes), hours: Number(info.hours) }), 'Сохранено');
                    if (ok) {
                      setInfo(null);
                      mod.reload();
                    }
                  }}
                >
                  Сохранить
                </Button>
              </>
            }
          >
            {info && (
              <div className="form">
                <Field label="Тема модуля">{(fid) => <input id={fid} className="input" value={info.title} onChange={(e) => setInfo({ ...info, title: e.target.value })} />}</Field>
                <Field label="Цель">{(fid) => <textarea id={fid} className="input textarea" value={info.goal} onChange={(e) => setInfo({ ...info, goal: e.target.value })} />}</Field>
                <Field label="Задачи" hint="Каждая задача с новой строки">{(fid) => <textarea id={fid} className="input textarea" value={info.tasks} onChange={(e) => setInfo({ ...info, tasks: e.target.value })} />}</Field>
                <Field label="Результаты учебной деятельности" hint="С новой строки, от лица учащегося: «понимаю…», «умею…», «могу применить…»">
                  {(fid) => <textarea id={fid} className="input textarea" value={info.outcomes} onChange={(e) => setInfo({ ...info, outcomes: e.target.value })} />}
                </Field>
                <Field label="Учебных часов">{(fid) => <input id={fid} className="input" type="number" min={1} max={40} value={info.hours} onChange={(e) => setInfo({ ...info, hours: Number(e.target.value) })} />}</Field>
              </div>
            )}
          </Modal>
        </>
      )}
    </Async>
  );
};

/* ---------- редакторы ---------- */
type ItemFull<T> = T & { module: { id: string; title: string }; course: { id: string; title: string }; canEdit: boolean };

/* неизвестный вид материала в адресе — понятное сообщение вместо ошибки API */
export const ItemEditor = () => {
  const { kind = 'lectures' } = useParams();
  if (!(kind in KIND)) {
    return (
      <Empty title="Страница не найдена" text="Возможно, ссылка устарела или материал перемещён в корзину.">
        <Link to="/courses">К курсам</Link>
      </Empty>
    );
  }
  return <ItemEditorPage />;
};

const ItemEditorPage = () => {
  const { kind = 'lectures', id = '' } = useParams();
  const { client } = useApp();
  const item = useLoad(() => client.call<ItemFull<Lecture & Test & Lab>>('GET', `/${kind}/${id}`), [kind, id]);
  return (
    <Async state={item}>
      {(it) => (
        <>
          <PageHead kicker={`${KIND[kind as Kind].one} · ${it.module.title}`} title={it.title} back={<Link to={`/modules/${it.module.id}`} className="back"><Icon name="arrow-left" size={16} /> Модуль</Link>}>
            {!it.canEdit && <Badge tone="info">только просмотр</Badge>}
            {kind === 'tests' && (
              <>
                <Link to={`/tests/${it.id}/stats`} className="btn">
                  <Icon name="chart" size={18} />
                  <span>Анализ заданий</span>
                </Link>
                <LiveStart testId={it.id} count={liveQuestions(it.questions).length} />
              </>
            )}
          </PageHead>
          {kind === 'lectures' && <LectureEditor item={it} onSaved={item.reload} />}
          {kind === 'tests' && <TestEditor item={it} onSaved={item.reload} />}
          {kind === 'labs' && <LabEditor item={it} onSaved={item.reload} />}
        </>
      )}
    </Async>
  );
};

const BLOCK_LABEL: Record<Block['type'], string> = {
  heading: 'Заголовок',
  text: 'Текст',
  list: 'Список',
  note: 'Выноска',
  code: 'Код',
  table: 'Таблица',
  image: 'Изображение',
  video: 'Видео',
  file: 'Файл',
  term: 'Термин словаря',
  crossword: 'Кроссворд',
};

const newBlock = (type: Block['type']): Block => {
  switch (type) {
    case 'list':
      return { type, items: [''], ordered: false };
    case 'note':
      return { type, text: '', tone: 'info' };
    case 'code':
      return { type, text: '', lang: '' };
    case 'table':
      return { type, rows: [['', ''], ['', '']] };
    case 'image':
    case 'file':
      return { type, fileId: '', caption: '' };
    case 'video':
      return { type, url: '', caption: '' };
    case 'term':
      return { type, term: '', definition: '' };
    case 'crossword':
      return { type, title: '', words: [] };
    default:
      return { type, text: '' } as Block;
  }
};

/* точки на рисунке: нажатие на рисунок ставит точку; у каждой — заголовок и пояснение.
   Учащийся нажимает на номер — деталь приближается, ниже появляется пояснение */
const PointsEditor = ({ block: b, onChange }: { block: Extract<Block, { type: 'image' }>; onChange: (b: Block) => void }) => {
  const file = useFileUrl(b.src ? null : b.fileId || null);
  const url = b.src ?? file;
  const pts = b.points ?? [];
  const set = (points: FigurePoint[]) => onChange({ ...b, points });
  const edit = (i: number, patch: Partial<FigurePoint>) => set(pts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  if (!url) return null;
  return (
    <details className="pts" open={pts.length > 0}>
      <summary>Точки на рисунке: {pts.length ? `${pts.length}` : 'нет'} — интерактивная схема</summary>
      <p className="muted small">Нажмите на рисунок, чтобы поставить точку, и подпишите её. Пояснение лучше брать из текста лекции.</p>
      <div
        className="pts__stage"
        role="button"
        tabIndex={0}
        aria-label="Поставить точку на рисунке"
        onClick={(e) => {
          if (pts.length >= 20) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
          const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
          set([...pts, { x, y, title: '', text: '' }]);
        }}
      >
        <img src={url} alt={b.caption} draggable={false} />
        {pts.map((p, i) => (
          <span key={i} className="tour__dot" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
            {i + 1}
          </span>
        ))}
      </div>
      {pts.length > 0 && (
        <ol className="pts__list">
          {pts.map((p, i) => (
            <li key={i} className="pts__row">
              <span className="tour__n">{i + 1}</span>
              <div className="pts__fields">
                <input className="input" aria-label={`Точка ${i + 1}: что на рисунке`} placeholder="Что на рисунке" value={p.title} onChange={(e) => edit(i, { title: e.target.value })} />
                <textarea className="input textarea" aria-label={`Точка ${i + 1}: пояснение`} placeholder="Пояснение" value={p.text} onChange={(e) => edit(i, { text: e.target.value })} />
              </div>
              <Button size="sm" kind="ghost" icon="trash" aria-label={`Удалить точку ${i + 1}`} onClick={() => set(pts.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ol>
      )}
    </details>
  );
};

/* список блоков с перестановкой — общий для лекций и лабораторных */
const BlocksEditor = ({ blocks, onChange }: { blocks: Block[]; onChange: (b: Block[]) => void }) => {
  const set = (i: number, b: Block) => onChange(blocks.map((x, j) => (j === i ? b : x)));
  const moveB = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <>
      <ol className="blocks">
        {blocks.map((b, i) => (
          <li key={i} className="blocks__item">
            <div className="blocks__head">
              <Badge>{BLOCK_LABEL[b.type]}</Badge>
              <span className="blocks__actions">
                <Button size="sm" kind="ghost" icon="up" aria-label="Выше" onClick={() => moveB(i, -1)} />
                <Button size="sm" kind="ghost" icon="down" aria-label="Ниже" onClick={() => moveB(i, 1)} />
                <Button size="sm" kind="ghost" icon="trash" aria-label="Удалить блок" onClick={() => onChange(blocks.filter((_, j) => j !== i))} />
              </span>
            </div>
            <BlockForm block={b} onChange={(nb) => set(i, nb)} />
          </li>
        ))}
      </ol>
      <div className="add-block">
        <span className="muted">Добавить блок:</span>
        {(Object.keys(BLOCK_LABEL) as Block['type'][]).map((t) => (
          <Button key={t} size="sm" onClick={() => onChange([...blocks, newBlock(t)])}>
            {BLOCK_LABEL[t]}
          </Button>
        ))}
      </div>
    </>
  );
};

const LectureEditor = ({ item, onSaved }: { item: ItemFull<Lecture>; onSaved: () => void }) => {
  const { client } = useApp();
  const [title, setTitle] = useState(item.title);
  const [blocks, setBlocks] = useState<Block[]>(item.blocks);
  const [preview, setPreview] = useState(false);
  const { busy, run } = useAction();

  if (!item.canEdit || preview) {
    return (
      <>
        {item.canEdit && <Button onClick={() => setPreview(false)}>Вернуться к редактированию</Button>}
        <article className="card lecture">
          <Blocks blocks={blocks} />
        </article>
      </>
    );
  }

  return (
    <div className="editor">
      <Field label="Название лекции">{(fid) => <input id={fid} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <BlocksEditor blocks={blocks} onChange={setBlocks} />
      <div className="editor__bar">
        <Button onClick={() => setPreview(true)} icon="eye">
          Предпросмотр
        </Button>
        <Button kind="primary" busy={busy} onClick={async () => (await run(() => client.call('PATCH', `/lectures/${item.id}`, { title, blocks }), 'Лекция сохранена')) && onSaved()}>
          Сохранить
        </Button>
      </div>
    </div>
  );
};

/* кроссворд: учитель пишет «СЛОВО — подсказка», сетка строится сама */
const CrosswordForm = ({ block: b, onChange }: { block: Extract<Block, { type: 'crossword' }>; onChange: (b: Block) => void }) => {
  const [text, setText] = useState(() => b.words.filter((w, i, all) => all.findIndex((x) => x.answer === w.answer) === i).map((w) => `${w.answer} — ${w.clue}`).join('\n'));
  const [note, setNote] = useState('');
  return (
    <div className="form">
      <input className="input" aria-label="Название кроссворда" placeholder="Тема кроссворда" value={b.title} onChange={(e) => onChange({ ...b, title: e.target.value })} />
      <Field label="Слова и подсказки" hint="Каждое с новой строки: СЛОВО — подсказка">
        {(fid) => <textarea id={fid} className="input textarea textarea--tall" value={text} onChange={(e) => setText(e.target.value)} placeholder={'ВЕРИФИКАЦИЯ — проверка соответствия результатов требованиям\nМОДЕЛЬ — структура процессов жизненного цикла'} />}
      </Field>
      <div className="actions">
        <Button
          icon="cycle"
          onClick={() => {
            const entries = text
              .split('\n')
              .map((line) => line.split(/\s+[—–-]\s+/))
              .filter((x) => x.length >= 2)
              .map(([answer, ...clue]) => ({ answer: answer!, clue: clue.join(' — ') }));
            const { words, skipped } = buildCrossword(entries);
            onChange({ ...b, words });
            setNote(skipped.length ? `Не поместились (нет общих букв): ${skipped.join(', ')}` : `Сетка построена: ${words.length} слов`);
          }}
        >
          Построить сетку
        </Button>
        {note && <span className="muted">{note}</span>}
      </div>
      {b.words.length > 0 && <Crossword title={b.title} words={b.words} />}
    </div>
  );
};

const Upload = ({ onDone, accept }: { onDone: (f: { id: string; name: string }) => void; accept?: string }) => {
  const { client } = useApp();
  const { busy, run } = useAction();
  return (
    <label className={`upload ${busy ? 'is-busy' : ''}`}>
      <input
        type="file"
        accept={accept}
        className="visually-hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const row = await run(() => client.upload(f, 'content'), 'Файл загружен');
          if (row) onDone({ id: row.id, name: row.name });
        }}
      />
      <span className="btn btn--sm">{busy ? 'Загрузка…' : 'Выбрать файл'}</span>
    </label>
  );
};

const BlockForm = ({ block: b, onChange }: { block: Block; onChange: (b: Block) => void }) => {
  switch (b.type) {
    case 'crossword':
      return <CrosswordForm block={b} onChange={onChange} />;
    case 'heading':
      return <input className="input" aria-label="Заголовок" value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} />;
    case 'text':
      return <textarea className="input textarea textarea--tall" aria-label="Текст" value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} placeholder="Абзацы разделяйте пустой строкой" />;
    case 'list':
      return (
        <>
          <textarea className="input textarea" aria-label="Пункты списка" value={b.items.join('\n')} onChange={(e) => onChange({ ...b, items: e.target.value.split('\n') })} placeholder="Каждый пункт с новой строки" />
          <label className="check">
            <input type="checkbox" checked={b.ordered} onChange={(e) => onChange({ ...b, ordered: e.target.checked })} />
            <span>Нумерованный</span>
          </label>
        </>
      );
    case 'note':
      return (
        <>
          <select className="input" aria-label="Вид выноски" value={b.tone} onChange={(e) => onChange({ ...b, tone: e.target.value as 'info' })}>
            <option value="info">Пояснение</option>
            <option value="warn">Типичная ошибка</option>
            <option value="ok">Совет</option>
          </select>
          <textarea className="input textarea" aria-label="Текст выноски" value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} />
        </>
      );
    case 'code':
      return <textarea className="input textarea textarea--code" aria-label="Код" value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} />;
    case 'table':
      return (
        <textarea
          className="input textarea"
          aria-label="Таблица"
          value={b.rows.map((r) => r.join(' | ')).join('\n')}
          onChange={(e) => onChange({ ...b, rows: e.target.value.split('\n').map((r) => r.split('|').map((c) => c.trim())) })}
          placeholder="Строки с новой строки, ячейки через |, первая строка — заголовок"
        />
      );
    case 'image':
    case 'file':
      return (
        <>
          <div className="form__row">
            <div>
              {b.type === 'image' && b.src ? <img className="blocks__thumb" src={b.src} alt={b.caption} /> : b.fileId ? <FileLink id={b.fileId} name={b.caption || 'файл загружен'} /> : <span className="muted">Файл не выбран</span>}
              <Upload accept={b.type === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : undefined} onDone={(f) => onChange({ ...b, fileId: f.id, caption: b.caption || f.name })} />
            </div>
            <input className="input" aria-label="Подпись" placeholder="Подпись" value={b.caption} onChange={(e) => onChange({ ...b, caption: e.target.value })} />
          </div>
          {b.type === 'image' && <PointsEditor block={b} onChange={onChange} />}
        </>
      );
    case 'video':
      return (
        <div className="form__row">
          <input className="input" aria-label="Ссылка на видео" placeholder="https://youtu.be/…" value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} />
          <input className="input" aria-label="Подпись" placeholder="Подпись" value={b.caption} onChange={(e) => onChange({ ...b, caption: e.target.value })} />
        </div>
      );
    case 'term':
      return (
        <div className="form__row">
          <input className="input" aria-label="Термин" placeholder="Термин" value={b.term} onChange={(e) => onChange({ ...b, term: e.target.value })} />
          <textarea className="input textarea" aria-label="Определение" placeholder="Определение" value={b.definition} onChange={(e) => onChange({ ...b, definition: e.target.value })} />
        </div>
      );
    default:
      return null;
  }
};

/* ---------- редактор теста ---------- */
const Q_LABEL: Record<QuestionType, string> = {
  single: 'Один ответ',
  multi: 'Несколько ответов',
  match: 'Соответствие',
  order: 'Последовательность',
  short: 'Краткий ответ',
  diagram: 'Элемент диаграммы',
};

const newQuestion = (n: number): Question => ({ id: `q${Date.now().toString(36)}${n}`, type: 'single', text: '', options: ['', ''], pairs: [], answer: [0], explain: '', points: 1 });

const TestEditor = ({ item, onSaved }: { item: ItemFull<Test>; onSaved: () => void }) => {
  const { client } = useApp();
  const [title, setTitle] = useState(item.title);
  const [settings, setSettings] = useState<TestSettings>(item.settings);
  const [qs, setQs] = useState<Question[]>(item.questions);
  const { busy, run } = useAction();
  const setQ = (i: number, q: Question) => setQs(qs.map((x, j) => (j === i ? q : x)));
  const ro = !item.canEdit;

  return (
    <div className="editor">
      <div className="form__row">
        <Field label="Название теста">{(fid) => <input id={fid} className="input" value={title} disabled={ro} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Режим">
          {(fid) => (
            <select id={fid} className="input" value={settings.mode} disabled={ro} onChange={(e) => setSettings({ ...settings, mode: e.target.value as 'self' })}>
              <option value="self">Самопроверка: сразу разбор ответов</option>
              <option value="control">Контроль: только итог</option>
            </select>
          )}
        </Field>
      </div>
      <div className="form__row form__row--4">
        <Field label="Проходной, %">{(fid) => <input id={fid} className="input" type="number" min={0} max={100} value={settings.passPercent} disabled={ro} onChange={(e) => setSettings({ ...settings, passPercent: Number(e.target.value) })} />}</Field>
        <Field label="Попыток (0 — без ограничений)">{(fid) => <input id={fid} className="input" type="number" min={0} max={20} value={settings.attempts} disabled={ro} onChange={(e) => setSettings({ ...settings, attempts: Number(e.target.value) })} />}</Field>
        <Field label="Время, мин (0 — без лимита)">{(fid) => <input id={fid} className="input" type="number" min={0} max={240} value={settings.timeLimitMin} disabled={ro} onChange={(e) => setSettings({ ...settings, timeLimitMin: Number(e.target.value) })} />}</Field>
        <Field label="Заданий в попытке (0 — все)" hint="Если в тесте заданий больше, каждому учащемуся достанется свой набор">
          {(fid) => <input id={fid} className="input" type="number" min={0} max={50} value={settings.pick ?? 0} disabled={ro} onChange={(e) => setSettings({ ...settings, pick: Number(e.target.value) })} />}
        </Field>
      </div>
      {/* флажки настроек — одной строкой под полями */}
      <div className="form__checks">
        <label className="check">
          <input type="checkbox" checked={settings.shuffle} disabled={ro} onChange={(e) => setSettings({ ...settings, shuffle: e.target.checked })} />
          <span>Свой порядок заданий и ответов у каждого</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={!!settings.draft} disabled={ro} onChange={(e) => setSettings({ ...settings, draft: e.target.checked })} />
          <span>Черновик: учащиеся тест не видят</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.gate ?? settings.mode !== 'control'} disabled={ro} onChange={(e) => setSettings({ ...settings, gate: e.target.checked })} />
          <span>Не пускать дальше: пока тест не сдан на проходной процент, следующие модули закрыты</span>
        </label>
      </div>
      <p className="muted">По требованиям к дидактическому конструктору в модуле должно быть от 5 до 10 тестовых заданий разных типов. Сейчас: {qs.length}.</p>
      <ol className="blocks">
        {qs.map((q, i) => (
          <li key={q.id} className="blocks__item">
            <div className="blocks__head">
              <strong>Задание {i + 1}</strong>
              <select className="input input--inline" aria-label="Тип задания" value={q.type} disabled={ro} onChange={(e) => {
                const type = e.target.value as QuestionType;
                setQ(i, { ...q, type, answer: type === 'single' ? [0] : type === 'multi' ? [] : type === 'short' ? [''] : [], pairs: type === 'match' ? q.options.map(() => '') : [] });
              }}>
                {(Object.keys(Q_LABEL) as QuestionType[]).filter((t) => t !== 'diagram').map((t) => (
                  <option key={t} value={t}>
                    {Q_LABEL[t]}
                  </option>
                ))}
              </select>
              {!ro && (
                <span className="blocks__actions">
                  <Button size="sm" kind="ghost" icon="trash" aria-label="Удалить задание" onClick={() => setQs(qs.filter((_, j) => j !== i))} />
                </span>
              )}
            </div>
            <textarea className="input textarea" aria-label="Формулировка" placeholder="Формулировка задания" value={q.text} disabled={ro} onChange={(e) => setQ(i, { ...q, text: e.target.value })} />
            {q.image && <img className="blocks__thumb" src={q.image} alt="Рисунок к заданию" />}
            <QuestionBody q={q} ro={ro} onChange={(nq) => setQ(i, nq)} />
            {(q.type === 'single' || q.type === 'multi') && (
              <label className="check">
                <input type="checkbox" checked={!!q.fixed} disabled={ro} onChange={(e) => setQ(i, { ...q, fixed: e.target.checked })} />
                <span>Не перемешивать варианты (есть «все перечисленные», «ответы a), c)» и т. п.)</span>
              </label>
            )}
            <input className="input" aria-label="Пояснение" placeholder="Пояснение после ответа (почему так)" value={q.explain} disabled={ro} onChange={(e) => setQ(i, { ...q, explain: e.target.value })} />
          </li>
        ))}
      </ol>
      {!ro && (
        <div className="editor__bar">
          <Button icon="plus" onClick={() => setQs([...qs, newQuestion(qs.length)])}>
            Задание
          </Button>
          <Button kind="primary" busy={busy} onClick={async () => (await run(() => client.call('PATCH', `/tests/${item.id}`, { title, settings, questions: qs.map((q) => (q.type === 'short' ? { ...q, options: [], answer: q.answer.map((a) => String(a).trim()).filter(Boolean) } : q)) }), 'Тест сохранён')) && onSaved()}>
            Сохранить
          </Button>
        </div>
      )}
    </div>
  );
};

const QuestionBody = ({ q, ro, onChange }: { q: Question; ro: boolean; onChange: (q: Question) => void }) => {
  const setOpt = (k: number, v: string) => onChange({ ...q, options: q.options.map((o, j) => (j === k ? v : o)) });
  if (q.type === 'short') {
    return (
      <Field label="Допустимые ответы" hint="Каждый вариант с новой строки; регистр, «ё» и знаки препинания не учитываются">
        {(fid) => <textarea id={fid} className="input textarea" value={q.answer.join('\n')} disabled={ro} onChange={(e) => onChange({ ...q, answer: e.target.value.split('\n') })} />}
      </Field>
    );
  }
  return (
    <div className="opts-edit">
      {q.type === 'order' && <p className="muted">Введите шаги в правильном порядке — учащемуся они покажутся перемешанными.</p>}
      {q.type === 'match' && <p className="muted">Слева элемент, справа — его пара. Правая колонка будет перемешана.</p>}
      {q.options.map((o, k) => (
        <div key={k} className="opts-edit__row">
          {q.type === 'single' && <input type="radio" name={`a-${q.id}`} aria-label="Правильный" checked={q.answer[0] === k} disabled={ro} onChange={() => onChange({ ...q, answer: [k] })} />}
          {q.type === 'multi' && <input type="checkbox" aria-label="Правильный" checked={q.answer.includes(k)} disabled={ro} onChange={(e) => onChange({ ...q, answer: e.target.checked ? [...q.answer, k] : q.answer.filter((x) => x !== k) })} />}
          {q.type === 'order' && <span className="opts-edit__n">{k + 1}</span>}
          <input className="input" aria-label={`Вариант ${k + 1}`} value={o} disabled={ro} onChange={(e) => setOpt(k, e.target.value)} />
          {q.type === 'match' && <input className="input" aria-label={`Пара для варианта ${k + 1}`} value={q.pairs[k] ?? ''} disabled={ro} onChange={(e) => onChange({ ...q, pairs: q.options.map((_, j) => (j === k ? e.target.value : (q.pairs[j] ?? ''))) })} />}
          {!ro && q.options.length > 2 && (
            <Button
              size="sm"
              kind="ghost"
              icon="x"
              aria-label="Убрать вариант"
              onClick={() => onChange({ ...q, options: q.options.filter((_, j) => j !== k), pairs: q.pairs.filter((_, j) => j !== k), answer: q.type === 'single' || q.type === 'multi' ? q.answer.filter((x) => x !== k).map((x) => (typeof x === 'number' && x > k ? x - 1 : x)) : q.answer })}
            />
          )}
        </div>
      ))}
      {!ro && q.options.length < 12 && (
        <Button size="sm" icon="plus" onClick={() => onChange({ ...q, options: [...q.options, ''], pairs: q.type === 'match' ? [...q.pairs, ''] : q.pairs })}>
          Вариант
        </Button>
      )}
    </div>
  );
};

/* ---------- редактор лабораторной ---------- */
const LabEditor = ({ item, onSaved }: { item: ItemFull<Lab> & { templates?: { id: string; name: string }[] }; onSaved: () => void }) => {
  const { client } = useApp();
  const [f, setF] = useState({ title: item.title, goal: item.goal, description: item.description, variants: item.variants.join('\n'), criteria: item.criteria.join('\n'), allowFiles: item.allowFiles, diagramKind: item.diagramKind ?? '' });
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>(item.templates ?? []);
  const [blocks, setBlocks] = useState<Block[]>(item.blocks ?? []);
  const [cq, setCq] = useState((item.controlQuestions ?? []).join('\n'));
  /* эталоны: по одному на вариант (или один на все) */
  const initRefs = (): (Diagram | null)[] => {
    const r = item.diagramReference as Diagram | (Diagram | null)[] | null;
    return Array.isArray(r) ? r : r ? [r] : [];
  };
  const [refs, setRefs] = useState<(Diagram | null)[]>(initRefs);
  const [refIdx, setRefIdx] = useState(0);
  const { busy, run } = useAction();
  const ro = !item.canEdit;
  const variantList = lines(f.variants);

  return (
    <div className="editor">
      <Field label="Название">{(fid) => <input id={fid} className="input" value={f.title} disabled={ro} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
      <Field label="Цель работы">{(fid) => <textarea id={fid} className="input textarea" value={f.goal} disabled={ro} onChange={(e) => setF({ ...f, goal: e.target.value })} />}</Field>
      <Field label="Краткое задание" hint="Подробности — в блоках теории и порядка выполнения ниже">{(fid) => <textarea id={fid} className="input textarea textarea--tall" value={f.description} disabled={ro} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <div className="form__row">
        <Field label="Варианты" hint="Каждый с новой строки">{(fid) => <textarea id={fid} className="input textarea" value={f.variants} disabled={ro} onChange={(e) => setF({ ...f, variants: e.target.value })} />}</Field>
        <Field label="Критерии оценивания" hint="Каждый с новой строки">{(fid) => <textarea id={fid} className="input textarea" value={f.criteria} disabled={ro} onChange={(e) => setF({ ...f, criteria: e.target.value })} />}</Field>
      </div>
      <div className="form__row">
        <Field label="Диаграмма UML в работе" hint="Учащийся сможет построить диаграмму во встроенном конструкторе">
          {(fid) => (
            <select id={fid} className="input" value={f.diagramKind} disabled={ro} onChange={(e) => setF({ ...f, diagramKind: e.target.value })}>
              <option value="">Не требуется</option>
              {DIAGRAM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DIAGRAM_SPEC[k].title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label className="check check--field">
          <input type="checkbox" checked={f.allowFiles} disabled={ro} onChange={(e) => setF({ ...f, allowFiles: e.target.checked })} />
          <span>Учащиеся прикрепляют файлы отчёта</span>
        </label>
      </div>
      {f.diagramKind && (
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Эталонная диаграмма для автопроверки</h2>
            {variantList.length > 1 && (
              <select className="input input--inline" aria-label="Вариант" value={refIdx} onChange={(e) => setRefIdx(Number(e.target.value))}>
                {variantList.map((v, i) => (
                  <option key={i} value={i}>
                    Вариант {i + 1}: {v}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="muted">Учащийся не видит эталон. При нажатии «Проверить» и при сдаче система сравнит его диаграмму с эталоном своего варианта и покажет процент совпадения и ошибки нотации. Если эталона нет — проверяется только нотация.</p>
          <DiagramEditor
            value={refs[refIdx]?.kind === f.diagramKind ? refs[refIdx]! : emptyDiagram(f.diagramKind)}
            readOnly={ro}
            onChange={(d) => {
              const next = refs.slice();
              while (next.length <= refIdx) next.push(null);
              next[refIdx] = d;
              setRefs(next);
            }}
          />
        </section>
      )}
      <section className="card">
        <h2 className="card__title">Теория, порядок выполнения, форма отчёта</h2>
        {ro ? <Blocks blocks={blocks} /> : <BlocksEditor blocks={blocks} onChange={setBlocks} />}
      </section>
      <Field label="Контрольные вопросы" hint="Каждый с новой строки">
        {(fid) => <textarea id={fid} className="input textarea" value={cq} disabled={ro} onChange={(e) => setCq(e.target.value)} />}
      </Field>
      <Field label="Файлы-шаблоны" hint="Методические указания, бланк отчёта и т. п.">
        {() => (
          <div className="files">
            {templates.map((t) => (
              <span key={t.id} className="files__item">
                <FileLink id={t.id} name={t.name} />
                {!ro && <Button size="sm" kind="ghost" icon="x" aria-label="Убрать файл" onClick={() => setTemplates(templates.filter((x) => x.id !== t.id))} />}
              </span>
            ))}
            {!ro && <Upload onDone={(file) => setTemplates([...templates, file])} />}
          </div>
        )}
      </Field>
      {!ro && (
        <div className="editor__bar">
          <Button
            kind="primary"
            busy={busy}
            onClick={async () =>
              (await run(
                () =>
                  client.call('PATCH', `/labs/${item.id}`, {
                    title: f.title,
                    goal: f.goal,
                    description: f.description,
                    variants: lines(f.variants),
                    criteria: lines(f.criteria),
                    allowFiles: f.allowFiles,
                    diagramKind: f.diagramKind || null,
                    templateFileIds: templates.map((t) => t.id),
                    blocks,
                    controlQuestions: lines(cq),
                    diagramReference: f.diagramKind ? refs.map((r) => (r && r.kind === f.diagramKind && r.nodes.length ? r : null)) : null,
                  }),
                'Лабораторная сохранена',
              )) && onSaved()
            }
          >
            Сохранить
          </Button>
        </div>
      )}
    </div>
  );
};
