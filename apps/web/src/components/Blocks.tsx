/* показ блоков лекции */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Block, CrosswordWord } from '@pc/core';
import { useApp } from '../lib/app.tsx';
import { Button, Icon } from '../ui/ui.tsx';

/* ссылка на файл: в автономном режиме — временный адрес из IndexedDB, на сервере — защищённый адрес API */
export const useFileUrl = (fileId: string | null) => {
  const { client } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!fileId) return;
    let made: string | null = null;
    client
      .fileUrl(fileId)
      .then((u) => {
        made = u;
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      if (made?.startsWith('blob:')) URL.revokeObjectURL(made);
    };
  }, [client, fileId]);
  return url;
};

export const FileLink = ({ id, name }: { id: string; name: string }) => {
  const { client, toast } = useApp();
  return (
    <button
      type="button"
      className="file-link"
      onClick={async () => {
        try {
          const url = await client.fileUrl(id);
          const a = Object.assign(document.createElement('a'), { href: url, download: name, target: '_blank', rel: 'noopener' });
          document.body.append(a);
          a.click();
          a.remove();
        } catch (e) {
          toast((e as Error).message, 'err');
        }
      }}
    >
      <Icon name="file" size={18} />
      <span>{name}</span>
    </button>
  );
};

/* **жирный** внутри текста */
export const rich = (t: string): ReactNode[] =>
  t.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) => (part.length > 4 && part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));

/* рисунок: по нажатию открывается крупно */
const Figure = ({ url, caption }: { url: string | null; caption: string }) => {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <figure className="lb-figure">
      {url ? (
        <button type="button" className="lb-figure__zoom" onClick={() => ref.current?.showModal()} aria-label={`Открыть крупно: ${caption || 'рисунок'}`}>
          <img src={url} alt={caption || 'Иллюстрация'} loading="lazy" />
        </button>
      ) : (
        <div className="lb-figure__stub">Изображение загружается…</div>
      )}
      {caption && <figcaption>{caption}</figcaption>}
      {url && (
        <dialog ref={ref} className="zoom" onClick={() => ref.current?.close()}>
          <img src={url} alt={caption || 'Иллюстрация'} />
          {caption && <p className="zoom__caption">{caption}</p>}
          <button type="button" className="zoom__close" aria-label="Закрыть">
            <Icon name="x" />
          </button>
        </dialog>
      )}
    </figure>
  );
};

const FileImg = ({ id, caption }: { id: string; caption: string }) => <Figure url={useFileUrl(id)} caption={caption} />;

/* видео только с проверенных сервисов */
const embed = (url: string) => {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  if (/^https:\/\/rutube\.ru\/video\/([\w]+)/.test(url)) return url.replace('/video/', '/play/embed/');
  return null;
};

export const Blocks = ({ blocks }: { blocks: Block[] }) => (
  <div className="lb">
    {blocks.map((b, i) => {
      const prev = blocks[i - 1];
      switch (b.type) {
        case 'heading':
          return (
            <h2 key={i} id={`h-${i}`} className="lb-h">
              {b.text}
            </h2>
          );
        case 'text':
          return b.text.split(/\n{2,}/).map((p, j) => (
            <p key={`${i}-${j}`} className="lb-p">
              {rich(p)}
            </p>
          ));
        case 'list': {
          /* список после заголовка «Контрольные вопросы» — самопроверка с отметками */
          if (prev?.type === 'heading' && /^Контрольные вопросы/i.test(prev.text)) return <SelfCheck key={i} items={b.items} />;
          const items = b.items.map((x, j) => <li key={j}>{rich(x)}</li>);
          return b.ordered ? (
            <ol key={i} className="lb-list">
              {items}
            </ol>
          ) : (
            <ul key={i} className="lb-list">
              {items}
            </ul>
          );
        }
        case 'note':
          return (
            <aside key={i} className={`note note--${b.tone === 'warn' ? 'warn' : b.tone === 'ok' ? 'ok' : 'info'}`}>
              {rich(b.text)}
            </aside>
          );
        case 'code':
          return (
            <pre key={i} className="lb-code">
              <code>{b.text}</code>
            </pre>
          );
        case 'table':
          return (
            <div key={i} className="table-wrap">
              <table className="table table--lecture">
                <thead>
                  <tr>
                    {b.rows[0]?.map((c, j) => (
                      <th key={j}>{rich(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.slice(1).map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k}>{rich(c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        case 'image':
          return b.src ? <Figure key={i} url={b.src} caption={b.caption} /> : <FileImg key={i} id={b.fileId} caption={b.caption} />;
        case 'file':
          return (
            <p key={i} className="lb-p">
              <FileLink id={b.fileId} name={b.caption || 'Файл'} />
            </p>
          );
        case 'video': {
          const src = embed(b.url);
          return (
            <figure key={i} className="lb-video">
              {src ? (
                <iframe src={src} title={b.caption || 'Видео'} allow="encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
              ) : (
                <a href={b.url} target="_blank" rel="noopener noreferrer">
                  {b.caption || b.url}
                </a>
              )}
              {b.caption && <figcaption>{b.caption}</figcaption>}
            </figure>
          );
        }
        case 'term':
          return (
            <dl key={i} className="lb-term">
              <dt>{b.term}</dt>
              <dd>{rich(b.definition)}</dd>
            </dl>
          );
        case 'crossword':
          return <Crossword key={i} title={b.title} words={b.words} />;
        default:
          return null;
      }
    })}
  </div>
);

/* самопроверка: учащийся отмечает вопросы, на которые может ответить; отметки хранятся в браузере */
const SelfCheck = ({ items }: { items: string[] }) => {
  const store = `pc.check.${items.join('|').length}.${items[0]?.slice(0, 40) ?? ''}`;
  const [done, setDone] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(store) ?? '[]') as number[];
    } catch {
      return [];
    }
  });
  const toggle = (i: number) => {
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i];
    setDone(next);
    try {
      localStorage.setItem(store, JSON.stringify(next));
    } catch {
      /* нет доступа к хранилищу */
    }
  };
  return (
    <div className="selfcheck">
      <p className="selfcheck__lead">
        Отметьте вопросы, на которые можете ответить без подсказки. <strong>{done.length} из {items.length}</strong>
      </p>
      <ol className="selfcheck__list">
        {items.map((x, i) => (
          <li key={i}>
            <label className={`selfcheck__item ${done.includes(i) ? 'is-done' : ''}`}>
              <input type="checkbox" checked={done.includes(i)} onChange={() => toggle(i)} />
              <span>{rich(x)}</span>
            </label>
          </li>
        ))}
      </ol>
    </div>
  );
};

/* ---------- интерактивный кроссворд ---------- */
type Dir = 'across' | 'down';
const cellKey = (r: number, c: number) => `${r}:${c}`;
const cellsOf = (w: CrosswordWord) => [...w.answer].map((_, i) => (w.dir === 'down' ? cellKey(w.row + i, w.col) : cellKey(w.row, w.col + i)));

export const Crossword = ({ title, words }: { title: string; words: CrosswordWord[] }) => {
  /* сетка: буква, номер, слова через клетку */
  const grid = useMemo(() => {
    const cells = new Map<string, { ch: string; n?: number; words: number[] }>();
    words.forEach((w, wi) => {
      [...w.answer].forEach((ch, i) => {
        const k = w.dir === 'down' ? cellKey(w.row + i, w.col) : cellKey(w.row, w.col + i);
        const cur = cells.get(k) ?? { ch, words: [] };
        cur.words.push(wi);
        if (i === 0) cur.n = w.n;
        cells.set(k, cur);
      });
    });
    const rows = Math.max(...words.map((w) => (w.dir === 'down' ? w.row + w.answer.length : w.row + 1)));
    const cols = Math.max(...words.map((w) => (w.dir === 'across' ? w.col + w.answer.length : w.col + 1)));
    return { cells, rows, cols };
  }, [words]);

  const store = `pc.cw.${words.map((w) => w.answer).join('').slice(0, 60)}`;
  const [vals, setVals] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(store) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [active, setActive] = useState<{ k: string; dir: Dir } | null>(null);
  const [checked, setChecked] = useState(false);
  const refs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    try {
      localStorage.setItem(store, JSON.stringify(vals));
    } catch {
      /* нет доступа к хранилищу */
    }
  }, [vals, store]);

  const wordAt = (k: string, dir: Dir) => grid.cells.get(k)?.words.map((wi) => words[wi]!).find((w) => w.dir === dir);
  const activeWord = active ? (wordAt(active.k, active.dir) ?? wordAt(active.k, active.dir === 'across' ? 'down' : 'across')) : undefined;
  const activeCells = new Set(activeWord ? cellsOf(activeWord) : []);

  const focus = (k: string, dir: Dir) => {
    setActive({ k, dir });
    refs.current.get(k)?.focus();
  };
  const step = (k: string, dir: Dir, d: number) => {
    const [r, c] = k.split(':').map(Number) as [number, number];
    const next = dir === 'down' ? cellKey(r + d, c) : cellKey(r, c + d);
    if (grid.cells.has(next)) focus(next, dir);
  };
  const solved = words.filter((w) => cellsOf(w).every((k, i) => vals[k] === w.answer[i]));
  const done = solved.length === words.length;

  const type = (k: string, raw: string) => {
    const ch = raw.toUpperCase().replace(/Ё/g, 'Е').replace(/[^А-ЯA-Z0-9]/g, '').slice(-1);
    setChecked(false);
    setVals((v) => ({ ...v, [k]: ch }));
    if (ch && active) step(k, activeWord?.dir ?? active.dir, 1);
  };

  return (
    <section className="cw" aria-label={`Кроссворд${title ? `: ${title}` : ''}`}>
      {title && <h2 className="lb-h">Кроссворд: {title}</h2>}
      <div className="cw__layout">
        <div className="cw__scroll">
          <div className="cw__grid" style={{ gridTemplateColumns: `repeat(${grid.cols}, var(--cw-cell))`, gridTemplateRows: `repeat(${grid.rows}, var(--cw-cell))` }}>
            {[...grid.cells.entries()].map(([k, cell]) => {
              const [r, c] = k.split(':').map(Number) as [number, number];
              const v = vals[k] ?? '';
              const state = checked && v ? (v === cell.ch ? 'is-ok' : 'is-bad') : '';
              return (
                <label key={k} className={`cw__cell ${activeCells.has(k) ? 'is-word' : ''} ${active?.k === k ? 'is-active' : ''} ${state}`} style={{ gridRow: r + 1, gridColumn: c + 1 }}>
                  {cell.n && <span className="cw__n">{cell.n}</span>}
                  <input
                    ref={(el) => {
                      if (el) refs.current.set(k, el);
                    }}
                    className="cw__input"
                    value={v}
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-label={`Клетка ${r + 1}-${c + 1}`}
                    onFocus={() => setActive((a) => (a?.k === k ? a : { k, dir: wordAt(k, a?.dir ?? 'across') ? (a?.dir ?? 'across') : a?.dir === 'down' ? 'across' : 'down' }))}
                    onClick={() => {
                      if (active?.k === k && cell.words.length > 1) setActive({ k, dir: active.dir === 'across' ? 'down' : 'across' });
                    }}
                    onChange={(e) => type(k, e.target.value)}
                    onKeyDown={(e) => {
                      const dir = activeWord?.dir ?? 'across';
                      if (e.key === 'Backspace' && !v) {
                        e.preventDefault();
                        step(k, dir, -1);
                      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        step(k, 'across', e.key === 'ArrowRight' ? 1 : -1);
                      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        step(k, 'down', e.key === 'ArrowDown' ? 1 : -1);
                      }
                    }}
                  />
                </label>
              );
            })}
          </div>
        </div>
        <div className="cw__clues">
          {(['across', 'down'] as Dir[]).map((dir) => (
            <div key={dir}>
              <h3 className="cw__head">{dir === 'across' ? 'По горизонтали' : 'По вертикали'}</h3>
              <ol className="cw__list">
                {words
                  .filter((w) => w.dir === dir)
                  .map((w) => (
                    <li key={`${w.n}${dir}`}>
                      <button
                        type="button"
                        className={`cw__clue ${activeWord === w ? 'is-active' : ''} ${checked && solved.includes(w) ? 'is-solved' : ''}`}
                        onClick={() => focus(cellsOf(w)[0]!, dir)}
                      >
                        <strong>{w.n}.</strong> {w.clue} <span className="cw__len">({w.answer.length})</span>
                      </button>
                    </li>
                  ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
      <div className="cw__bar">
        <Button kind="primary" icon="check" onClick={() => setChecked(true)}>
          Проверить
        </Button>
        <Button
          icon="eye"
          disabled={!active}
          onClick={() => {
            if (!active) return;
            const ch = grid.cells.get(active.k)!.ch;
            setVals((v) => ({ ...v, [active.k]: ch }));
          }}
        >
          Открыть букву
        </Button>
        <Button kind="ghost" onClick={() => (setVals({}), setChecked(false))}>
          Очистить
        </Button>
        <span className="cw__score" role="status">
          {checked ? (done ? 'Кроссворд разгадан!' : `Верно слов: ${solved.length} из ${words.length}`) : `Слов: ${words.length}`}
        </span>
      </div>
    </section>
  );
};
