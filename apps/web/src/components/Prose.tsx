/* «живой текст»: абзацы и списки лекции оформляются по своему строению —
   определение становится карточкой, перечень «название — пояснение» плитками, нумерованный список шкалой этапов,
   «Например…», «Важно…», «Таким образом…» — выносками. Слова преподавателя не меняются */
import { Fragment, type ReactNode } from 'react';
import { Icon } from '../ui/ui.tsx';
import { markTerms, type GlossTerm } from './Terms.tsx';

/* **жирный** внутри текста; terms — термины словаря, которые нужно отметить (каждый один раз на набор блоков) */
export const rich = (t: string, terms?: GlossTerm[], used?: Set<string>): ReactNode[] =>
  t.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : terms?.length && used ? (
      <Fragment key={i}>{markTerms(part, terms, used, String(i))}</Fragment>
    ) : (
      part
    ),
  );

type R = (t: string) => ReactNode[];

/* ---------- определение ---------- */
export interface Def {
  term: string;
  aside: string;
  body: string;
}
/* слова, с которых начинается обычное предложение, а не термин («Первый этап – анализ…») */
const NOT_TERM = new Set('это он она оно они его её их все всё эти этот эта такой такая такие также здесь там тогда теперь если когда однако при для в во на с со по как что так но и а или к из от до за под над об о у же первый первая первое второй вторая третий третья каждый каждая каждое данный данная любой один одна одно два две три этап шаг чтобы фактически главная главный основная основной другой другая другие важная важный'.split(' '));
/* слова, которых не бывает в названии термина: «Интерфейс бывает двух видов – …», «Производство ПО сегодня – …» */
const VERBISH = new Set('бывает бывают включает включают является являются сегодня же может могут состоит имеет имеют описывает содержит называется'.split(' '));
const clip = (s: string) => s.trim().replace(/[:.,;]$/, '').trim();

export const defOf = (p: string): Def | null => {
  if (p.length > 1400) return null;
  /* «**Термин** (english) – …» или «**Термин:** …» */
  let m = p.match(/^\*\*([^*]{2,80})\*\*\s*(\([^)]{1,80}\))?\s*(?:[—–:-]\s*(?:это\s+)?)?([\s\S]{12,})$/);
  if (m && !/[.!?]\s/.test(m[1]!)) return { term: clip(m[1]!), aside: m[2]?.slice(1, -1) ?? '', body: m[3]!.trim() };
  /* «Термин – это …», «Термин (english) – …»: до шести слов с заглавной буквы */
  m = p.match(/^([А-ЯЁA-Z][^\s.!?:;—–()]*(?:[ -][^\s.!?:;—–()]+){0,3}?)\s*(\([^)]{1,80}\))?\s+[—–]\s+(?:это\s+)?([\s\S]{20,})$/);
  const words = m ? m[1]!.toLowerCase().split(/[\s-]+/) : [];
  if (m && !NOT_TERM.has(words[0]!) && !words.some((w) => VERBISH.has(w))) return { term: m[1]!.trim(), aside: m[2]?.slice(1, -1) ?? '', body: m[3]!.trim() };
  return null;
};

/* ---------- выноски ---------- */
type Tone = 'example' | 'important' | 'note' | 'summary';
const CALLOUTS: { re: RegExp; tone: Tone; label: string; icon: string }[] = [
  { re: /^(например|пример)(?![а-яё])/i, tone: 'example', label: 'Пример', icon: 'bulb' },
  { re: /^(важно|обратите внимание|внимание)(?![а-яё])/i, tone: 'important', label: 'Важно', icon: 'alert' },
  { re: /^(примечание|замечание)(?![а-яё])/i, tone: 'note', label: 'Примечание', icon: 'info' },
  { re: /^(таким образом|итак|вывод|выводы|в итоге|следовательно|в заключение)(?![а-яё])/i, tone: 'summary', label: 'Вывод', icon: 'check' },
];
const calloutOf = (p: string) => {
  const plain = p.replace(/^\*\*/, '');
  const c = CALLOUTS.find((x) => x.re.test(plain));
  if (!c || p.length > 1600) return null;
  /* «Примечание: …», «Вывод. …» — слово-метка уже в заголовке выноски */
  const text = p.replace(/^\*{0,2}(примечание|замечание|важно|вывод|выводы|пример)\s*[:.]\s*\*{0,2}\s*/i, '');
  return { ...c, text: text || p };
};

/* ---------- длинный абзац — на части по границам предложений ---------- */
const chunks = (p: string): string[] => {
  if (p.length <= 700) return [p];
  const sents = p.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«(])/);
  const out: string[] = [];
  let cur = '';
  for (const s of sents) {
    const open = ((cur.match(/\*\*/g)?.length ?? 0) % 2) === 1;
    if (cur && !open && cur.length + s.length > 430) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  if (out.length > 1 && out[out.length - 1]!.length < 140) {
    const tail = out.pop()!;
    out[out.length - 1] += ` ${tail}`;
  }
  return out;
};

export const renderPara = (p: string, r: R, key: string): ReactNode => {
  const d = defOf(p);
  if (d)
    return (
      <section key={key} className="lb-def" data-def={d.term}>
        <p className="lb-def__term">
          <span>{d.term}</span>
          {d.aside && <span className="lb-def__aside">{d.aside}</span>}
        </p>
        {chunks(d.body).map((c, k) => (
          <p key={k} className="lb-def__body">
            {r(c)}
          </p>
        ))}
      </section>
    );
  const c = calloutOf(p);
  if (c)
    return (
      <aside key={key} className={`lb-call lb-call--${c.tone}`}>
        <p className="lb-call__label">
          <Icon name={c.icon} size={16} /> {c.label}
        </p>
        {chunks(c.text).map((x, k) => (
          <p key={k}>{r(x)}</p>
        ))}
      </aside>
    );
  const parts = chunks(p);
  return parts.length === 1 ? (
    <p key={key} className="lb-p">
      {r(p)}
    </p>
  ) : (
    <Fragment key={key}>
      {parts.map((x, k) => (
        <p key={k} className="lb-p">
          {r(x)}
        </p>
      ))}
    </Fragment>
  );
};

/* ключевые понятия шага — термины из карточек-определений */
export const defTermsOf = (blocks: { type: string; text?: string }[]) =>
  blocks
    .flatMap((b) => (b.type === 'text' && b.text ? b.text.split(/\n{2,}/) : []))
    .map((p) => defOf(p)?.term)
    .filter((t): t is string => !!t && t.length <= 60)
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, 6);

/* ---------- списки ---------- */
const headOf = (x: string): { head: string; tail: string } | null => {
  let m = x.match(/^\*\*([^*]{2,70})\*\*\s*[—–:-]?\s*([\s\S]{6,})$/);
  if (m) return { head: clip(m[1]!), tail: m[2]!.trim() };
  m = x.match(/^([^.;:!?—–*]{2,60}?)\s+[—–]\s+([\s\S]{8,})$/);
  if (m) return { head: m[1]!.trim(), tail: m[2]!.trim() };
  m = x.match(/^([^.;:!?—–*]{2,45}?):\s+([\s\S]{8,})$/);
  if (m) return { head: m[1]!.trim(), tail: m[2]!.trim() };
  return null;
};
/* «;» и «.» в конце пункта в плитке не нужны */
const tidy = (x: string) => x.replace(/[;,.]\s*$/, '');

export const renderList = (items: string[], ordered: boolean, r: R, key: number): ReactNode => {
  const heads = items.map(headOf);
  const withHead = heads.filter(Boolean).length;
  /* одиночный пункт — главная мысль раздела: крупно, с цветной чертой */
  if (!ordered && items.length === 1)
    return (
      <p key={key} className="lb-key">
        {r(items[0]!)}
      </p>
    );
  if (ordered)
    return (
      <ol key={key} className="lb-steps">
        {items.map((x, j) => {
          const h = heads[j];
          return (
            <li key={j} className="lb-steps__item">
              <span className="lb-steps__n" aria-hidden="true">
                {j + 1}
              </span>
              <div className="lb-steps__body">
                {h ? (
                  <>
                    <strong className="lb-steps__head">{h.head}</strong> {r(h.tail)}
                  </>
                ) : (
                  r(x)
                )}
              </div>
            </li>
          );
        })}
      </ol>
    );
  if (items.length >= 2 && items.length <= 16 && withHead >= Math.ceil(items.length * 0.6))
    return (
      <ul key={key} className="lb-tiles">
        {items.map((x, j) => {
          const h = heads[j];
          return (
            <li key={j} className="lb-tile">
              {h && <p className="lb-tile__head">{h.head}</p>}
              <p className="lb-tile__text">{r(tidy(h ? h.tail : x))}</p>
            </li>
          );
        })}
      </ul>
    );
  if (items.length >= 3 && items.length <= 14 && items.every((x) => x.replace(/\*\*/g, '').length <= 70))
    return (
      <ul key={key} className="lb-chips">
        {items.map((x, j) => (
          <li key={j} className="lb-chip">
            <Icon name="check" size={16} />
            <span>{r(tidy(x))}</span>
          </li>
        ))}
      </ul>
    );
  const cols = items.length > 14 && items.every((x) => x.replace(/\*\*/g, '').length <= 60);
  return (
    <ul key={key} className={`lb-list lb-list--dots ${cols ? 'lb-list--cols' : ''}`}>
      {items.map((x, j) => (
        <li key={j}>{r(x)}</li>
      ))}
    </ul>
  );
};
