/* чтение лекции: разделы, место вопроса по ходу чтения, очистка повторов после импорта */
import type { Block, Lecture } from '../model.ts';
import { blockText, fold } from './search.ts';

/* раздел лекции: блоки между заголовками; last — номер последнего блока раздела в лекции.
   Одна и та же функция и на сервере, и в браузере — номера блоков совпадают */
export interface LecturePart {
  title: string;
  blocks: Block[];
  last: number;
}
export const lectureParts = (blocks: Block[]): LecturePart[] => {
  const out: LecturePart[] = [];
  blocks.forEach((b, i) => {
    if (b.type === 'heading') out.push({ title: b.text, blocks: [], last: i });
    else if (out.length) {
      const p = out[out.length - 1]!;
      p.blocks.push(b);
      p.last = i;
    } else out.push({ title: 'Основные понятия', blocks: [b], last: i });
  });
  return out.filter((x) => x.blocks.length);
};

/* основы слов: первые пять букв; служебные слова и слова формулировки задания не считаются */
const STOP = new Set(['котор', 'являе', 'какой', 'какие', 'каком', 'какая', 'каких', 'выбер', 'назыв', 'относ', 'утвер', 'верно', 'невер', 'следу', 'также', 'можно', 'нужно', 'этого', 'более', 'между', 'через', 'всего', 'после', 'други', 'перечи', 'ответ', 'опред', 'пример', 'основ', 'укажи']);
const words = (s: string) => (fold(s).match(/[a-zа-я0-9]{4,}/g) ?? []).map((w) => w.slice(0, 5)).filter((w) => !STOP.has(w));
const partText = (p: LecturePart) => [p.title, ...p.blocks.map(blockText)].join(' ');
/* после списка вопросов и литературы вопрос не ставится */
const SKIP = /^(контрольные вопросы|вопросы для само|вопросы\s*$|литература|список (использованн|литератур)|источники)/i;

/* редкость основ по всем разделам курса: общие для предмета слова («система», «процесс») почти не весят */
export interface Rarity {
  df: Map<string, number>;
  n: number;
}
export const courseRarity = (lectures: Pick<Lecture, 'blocks'>[]): Rarity => {
  const df = new Map<string, number>();
  let n = 0;
  for (const l of lectures)
    for (const p of lectureParts(l.blocks)) {
      n++;
      for (const k of new Set(words(partText(p)))) df.set(k, (df.get(k) ?? 0) + 1);
    }
  return { df, n };
};

/* для каждого задания — номер блока, после которого его показать, или null (тогда — в «Проверьте себя» в конце).
   Мера — косинус между заданием и разделом по редким основам; задание ставится, только если раздел заметно
   ближе остальных, и в разделе не больше одного задания */
export const placeReading = (blocks: Block[], questions: { text: string; options: string[] }[], rarity: Rarity): (number | null)[] => {
  const parts = lectureParts(blocks);
  const idf = (k: string) => Math.log((rarity.n + 1) / ((rarity.df.get(k) ?? 0) + 1)) + 0.1;
  const present = new Set<string>();
  const vecs = parts.map((p) => {
    const tf = new Map<string, number>();
    for (const k of words(partText(p))) tf.set(k, (tf.get(k) ?? 0) + 1);
    for (const k of tf.keys()) present.add(k);
    if (SKIP.test(p.title.trim())) return null;
    return new Map([...tf].map(([k, n]) => [k, (1 + Math.log(n)) * idf(k)]));
  });
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0)) || 1;
  const cands: { qi: number; pi: number; s: number }[] = [];
  questions.forEach((q, qi) => {
    const qv = new Map([...new Set(words(`${q.text} ${q.options.join(' ')}`))].filter((k) => present.has(k)).map((k) => [k, idf(k)]));
    if (!qv.size) return;
    const sc = vecs
      .map((v, pi) => {
        if (!v) return { pi, s: 0, n: 0 };
        let dot = 0;
        let n = 0;
        for (const [k, w] of qv) {
          const x = v.get(k);
          if (x) {
            dot += w * x;
            n++;
          }
        }
        return { pi, s: dot / (norm(qv) * norm(v)), n };
      })
      .sort((a, b) => b.s - a.s);
    const [a, b] = sc;
    if (a && a.s >= 0.15 && a.n >= 3 && (!b || a.s >= 1.25 * b.s)) cands.push({ qi, pi: a.pi, s: a.s });
  });
  cands.sort((x, y) => y.s - x.s);
  const out: (number | null)[] = questions.map(() => null);
  const taken = new Set<number>();
  for (const c of cands) {
    if (taken.has(c.pi)) continue;
    taken.add(c.pi);
    out[c.qi] = parts[c.pi]!.last;
  }
  return out;
};

/* ---------- повторы после импорта ----------
   Текст из надписей Word при импорте иногда попадает в абзац несколько раз подряд
   («Требование – описание… Требование – описание… **Требование** – описание…»).
   Повтор убирается, выделение термина из повторной копии переносится в оставленную */
const key = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, '');

/* начало оставленного предложения выделяется так же, как в копии: «**Концепция продукта** …» */
const carryBold = (kept: string, copy: string) => {
  if (kept.includes('**')) return kept;
  const m = copy.match(/^\*\*([^*]{2,80})\*\*/);
  if (!m) return kept;
  const want = m[1]!.replace(/\s+/g, '');
  let i = 0;
  let got = 0;
  while (i < kept.length && got < want.length) {
    if (!/\s/.test(kept[i]!)) {
      if (kept[i] !== want[got]) return kept;
      got++;
    }
    i++;
  }
  return got === want.length ? `**${kept.slice(0, i)}**${kept.slice(i)}` : kept;
};

/* абзац — одна и та же часть, повторённая k раз (без знаков препинания между копиями) */
const repeatedWhole = (p: string) => {
  const k0 = key(p);
  for (let k = 8; k >= 2; k--) {
    if (k0.length % k || k0.length / k < 5) continue;
    const unit = k0.slice(0, k0.length / k);
    if (unit.repeat(k) !== k0) continue;
    /* первая копия в исходной записи: столько же значимых знаков */
    let i = 0;
    let got = 0;
    while (i < p.length && got < unit.length) {
      if (!/\s/.test(p[i]!) && p[i] !== '*') got++;
      i++;
    }
    /* выделение, закрытое сразу после первой копии, остаётся с ней */
    let head = p.slice(0, i);
    if ((head.match(/\*\*/g)?.length ?? 0) % 2 === 1 && p.startsWith('**', i)) head += '**';
    /* выделение термина из следующих копий переносится в оставленную */
    return carryBold(head.trim(), p.includes('**') ? p.slice(p.indexOf('**')) : '');
  }
  return null;
};

/* подписи со схемы, склеенные без пробелов («…FrameworkКлассы для работы с даннымиWeb Services…»), — через «·» */
const unglue = (p: string) => {
  const glued = p.match(/[a-zа-яё)][A-ZА-ЯЁ]/g)?.length ?? 0;
  return glued >= 3 && !/[.!?]\s/.test(p) ? p.replace(/([a-zа-яё)])([A-ZА-ЯЁ])/g, '$1 · $2') : p;
};

export const cleanRepeats = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map((p) => {
      const whole = repeatedWhole(p);
      if (whole) return unglue(whole);
      const sents = p.split(/(?<=[.!?)])\s*(?=\*{0,2}[А-ЯЁA-Z«(])/);
      if (sents.length < 2) return p;
      const seen = new Map<string, number>();
      const out: string[] = [];
      let dropped = false;
      for (const s of sents) {
        const k = key(s);
        const at = k.length >= 40 ? seen.get(k) : undefined;
        if (at === undefined) {
          if (k.length >= 40) seen.set(k, out.length);
          out.push(s);
        } else {
          out[at] = carryBold(out[at]!, s.trim());
          dropped = true;
        }
      }
      if (!dropped) return p;
      /* между предложениями — пробел (в склейке его не было: «…задачи.Требование…») */
      return out.map((s) => s.trim()).join(' ');
    })
    .join('\n\n');
