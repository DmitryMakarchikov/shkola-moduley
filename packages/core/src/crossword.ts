/* построение сетки кроссворда из слов и подсказок: слова укладываются с пересечениями */
import type { CrosswordWord } from './model.ts';

interface Entry {
  answer: string;
  clue: string;
}

type Placed = { answer: string; clue: string; row: number; col: number; dir: 'across' | 'down' };

export const normWord = (s: string) => s.toUpperCase().replace(/Ё/g, 'Е').replace(/[^А-ЯA-Z0-9]/g, '');

export const buildCrossword = (entries: Entry[]): { words: CrosswordWord[]; skipped: string[] } => {
  const list = entries
    .map((e) => ({ answer: normWord(e.answer), clue: e.clue.trim() }))
    .filter((e) => e.answer.length >= 2 && e.clue)
    .sort((a, b) => b.answer.length - a.answer.length);
  const grid = new Map<string, string>();
  const placed: Placed[] = [];
  const skipped: string[] = [];
  const key = (r: number, c: number) => `${r}:${c}`;
  const cellsOf = (p: Omit<Placed, 'clue'>) => [...p.answer].map((ch, i) => ({ r: p.dir === 'down' ? p.row + i : p.row, c: p.dir === 'down' ? p.col : p.col + i, ch }));

  /* можно ли положить слово: совпадения на пересечениях, без касаний соседних слов */
  const fits = (p: Omit<Placed, 'clue'>) => {
    let cross = 0;
    const cells = cellsOf(p);
    const [dr, dc] = p.dir === 'down' ? [1, 0] : [0, 1];
    const before = key(p.row - dr, p.col - dc);
    const after = key(cells[cells.length - 1]!.r + dr, cells[cells.length - 1]!.c + dc);
    if (grid.has(before) || grid.has(after)) return -1;
    for (const { r, c, ch } of cells) {
      const cur = grid.get(key(r, c));
      if (cur) {
        if (cur !== ch) return -1;
        cross++;
        continue;
      }
      /* соседние клетки поперёк направления должны быть пустыми */
      const side = p.dir === 'down' ? [key(r, c - 1), key(r, c + 1)] : [key(r - 1, c), key(r + 1, c)];
      if (side.some((k) => grid.has(k))) return -1;
    }
    return cross;
  };

  for (const e of list) {
    if (!placed.length) {
      placed.push({ ...e, row: 0, col: 0, dir: 'across' });
      cellsOf(placed[0]!).forEach(({ r, c, ch }) => grid.set(key(r, c), ch));
      continue;
    }
    let best: { p: Omit<Placed, 'clue'>; score: number } | null = null;
    for (const w of placed) {
      for (const [i, ch] of [...w.answer].entries()) {
        for (const [j, ch2] of [...e.answer].entries()) {
          if (ch !== ch2) continue;
          const dir: 'across' | 'down' = w.dir === 'across' ? 'down' : 'across';
          const r0 = w.dir === 'across' ? w.row - j : w.row + i;
          const c0 = w.dir === 'across' ? w.col + i : w.col - j;
          const p = { answer: e.answer, row: r0, col: c0, dir };
          const cross = fits(p);
          if (cross < 1) continue;
          /* больше пересечений и ближе к центру — лучше */
          const score = cross * 100 - Math.abs(r0) - Math.abs(c0);
          if (!best || score > best.score) best = { p, score };
        }
      }
    }
    if (!best) {
      skipped.push(e.answer);
      continue;
    }
    placed.push({ ...best.p, clue: e.clue });
    cellsOf(best.p).forEach(({ r, c, ch }) => grid.set(key(r, c), ch));
  }

  /* сдвиг к началу координат и нумерация по порядку чтения */
  const minR = Math.min(...placed.map((p) => p.row));
  const minC = Math.min(...placed.map((p) => p.col));
  const starts = [...new Set(placed.map((p) => key(p.row - minR, p.col - minC)))].map((k) => k.split(':').map(Number) as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const num = new Map(starts.map(([r, c], i) => [key(r, c), i + 1]));
  const words = placed.map((p) => ({ n: num.get(key(p.row - minR, p.col - minC))!, dir: p.dir, row: p.row - minR, col: p.col - minC, answer: p.answer, clue: p.clue }));
  words.sort((a, b) => a.n - b.n || (a.dir === 'across' ? -1 : 1));
  return { words, skipped };
};
