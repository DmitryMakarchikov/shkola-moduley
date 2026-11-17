/* термины словаря курса в тексте лекции: слово подчёркнуто пунктиром,
   по наведению или нажатию — определение из лекции, где термин введён */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { cleanTerm, fold } from '@pc/core';

export interface GlossTerm {
  key: string;
  term: string;
  def: string;
  lectureId: string;
  lecture: string;
  moduleNo: number;
  link: string;
  re: RegExp;
}

/* окончания, которые отбрасываются, чтобы термин находился в любом падеже */
const ENDINGS = ['иями', 'ями', 'ами', 'ией', 'ием', 'иям', 'иях', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ую', 'юю', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ой', 'ей', 'ия', 'ью', 'ов', 'ев', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'а', 'я', 'ы', 'и', 'е', 'о', 'у', 'ю', 'ь', 'й'];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[её]/g, '[её]');

const wordRe = (w: string) => {
  const low = w.toLowerCase();
  /* дефис: «CASE-средство» — изменяется только последняя часть */
  const cut = low.lastIndexOf('-');
  const head = cut >= 0 ? low.slice(0, cut + 1) : '';
  const tail = low.slice(cut + 1);
  if (!/^[а-яё]{4,}$/.test(tail)) return esc(low);
  const end = ENDINGS.find((e) => tail.endsWith(e) && tail.length - e.length >= 4);
  return esc(head + (end ? tail.slice(0, -end.length) : tail)) + '\\p{L}{0,4}';
};

/* шаблон поиска термина: слова с любыми окончаниями, только целыми словами.
   Сокращения («ПО», «UML») — с учётом регистра, чтобы «по» в тексте не считалось термином */
export const termRe = (term: string): RegExp | null => {
  /* знак ударения («Структу́рное») в тексте лекции обычно не ставится */
  const clean = term.replace(/[̀́]/g, '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[«»"]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length || clean.length < 2 || words.length > 6) return null;
  const caps = words.length === 1 && /^[A-ZА-ЯЁ0-9-]{2,8}$/.test(clean);
  const body = caps ? esc(clean) : words.map(wordRe).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, caps ? 'u' : 'iu');
};

export const TermsCtx = createContext<GlossTerm[]>([]);
export const useTerms = () => useContext(TermsCtx);

/* разметка строки: каждый термин отмечается один раз (used — уже отмеченные в этом фрагменте) */
export const markTerms = (text: string, terms: GlossTerm[], used: Set<string>, keyBase: string): ReactNode[] => {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  /* не больше восьми отмеченных терминов на шаг: подсказки не должны пестрить */
  while (used.size < 8) {
    let best: { t: GlossTerm; at: number; len: number } | null = null;
    for (const t of terms) {
      if (used.has(t.key)) continue;
      const m = t.re.exec(rest);
      if (m && (!best || m.index < best.at || (m.index === best.at && m[0].length > best.len))) best = { t, at: m.index, len: m[0].length };
    }
    if (!best) break;
    used.add(best.t.key);
    if (best.at) out.push(rest.slice(0, best.at));
    out.push(
      <TermRef key={`${keyBase}-${k++}`} term={best.t}>
        {rest.slice(best.at, best.at + best.len)}
      </TermRef>,
    );
    rest = rest.slice(best.at + best.len);
  }
  if (rest) out.push(rest);
  return out;
};

/* какие термины отмечать в наборе блоков: не те, чьё определение стоит здесь же */
export const termsFor = (terms: GlossTerm[], ownTerms: string[]) => {
  if (!terms.length) return terms;
  const own = new Set(ownTerms.map((t) => fold(cleanTerm(t).replace(/\s*\([^)]*\)\s*/g, ' ').trim())));
  return terms.filter((t) => !own.has(t.key));
};

const canHover = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

export const TermRef = ({ term, children }: { term: GlossTerm; children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(360, innerWidth - 32);
    const left = Math.max(16, Math.min(r.left - 12, innerWidth - 16 - width));
    const h = pop.current?.offsetHeight ?? 200;
    const up = r.bottom + h + 16 > innerHeight && r.top > h + 16;
    setPos({ left, top: up ? r.top - 8 : r.bottom + 8, up, width });
  };
  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  /* после первого показа известна высота карточки — уточняем, сверху её показать или снизу */
  useLayoutEffect(() => {
    if (open) place();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    addEventListener('pointerdown', away);
    addEventListener('keydown', key);
    addEventListener('scroll', place, { passive: true, capture: true });
    addEventListener('resize', place);
    return () => {
      removeEventListener('pointerdown', away);
      removeEventListener('keydown', key);
      removeEventListener('scroll', place, { capture: true });
      removeEventListener('resize', place);
    };
  }, [open]);

  const hoverOn = () => canHover() && later(() => setOpen(true), 280);
  const hoverOff = () => canHover() && later(() => setOpen(false), 220);
  const short = term.def.length > 420 ? term.def.slice(0, 400).replace(/\s+\S*$/, '') + '…' : term.def;

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`tref ${open ? 'is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          clearTimeout(timer.current);
          setOpen((v) => !v);
        }}
        onMouseEnter={hoverOn}
        onMouseLeave={hoverOff}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className={`tpop ${pos?.up ? 'tpop--up' : ''}`}
            role="dialog"
            aria-label={`Термин: ${term.term}`}
            style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden', left: 0, top: 0 }}
            onMouseEnter={() => clearTimeout(timer.current)}
            onMouseLeave={hoverOff}
          >
            <p className="tpop__kicker">{`Термин · тема ${term.moduleNo}`}</p>
            <p className="tpop__term">{term.term}</p>
            <p className="tpop__def">{short}</p>
            <Link className="tpop__link" to={term.link} onClick={() => setOpen(false)}>
              Открыть в словаре курса
            </Link>
          </div>,
          document.body,
        )}
    </>
  );
};
