/* словарь терминов курса: все термины лекций по алфавиту, с поиском, указателем по буквам и ссылкой на тему,
   где термин объясняется. Карточки и тренажёр — по всему словарю */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { fold, hasWords, queryWords } from '@pc/core';
import { Hl } from '../components/Search.tsx';
import { useApp } from '../lib/app.tsx';
import { itemLink, plural } from '../lib/format.ts';
import { useLoad } from '../lib/hooks.ts';
import { Async, Button, Empty, Icon, PageHead } from '../ui/ui.tsx';
import { TermCards, TermQuiz } from './learn.tsx';

interface Def {
  text: string;
  lectureId: string;
  lecture: string;
  moduleId: string;
  module: string;
  moduleNo: number;
  section: string;
  locked: boolean;
}
interface Glossary {
  course: { id: string; title: string };
  preview: boolean;
  sections: string[];
  letters: string[];
  terms: { key: string; term: string; letter: string; defs: Def[] }[];
}

type Mode = 'list' | 'cards' | 'drill';

export const GlossaryPage = () => {
  const { courseId = '' } = useParams();
  const { client } = useApp();
  const [sp] = useSearchParams();
  const focus = sp.get('t') ?? '';
  const g = useLoad(() => client.call<Glossary>('GET', `/learn/courses/${courseId}/glossary`), [courseId]);
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [mode, setMode] = useState<Mode>('list');
  const words = useMemo(() => queryWords(q), [q]);

  const shown = useMemo(() => {
    const all = g.data?.terms ?? [];
    return all.filter((t) => {
      if (section && !t.defs.some((d) => d.section === section)) return false;
      return !words.length || hasWords(`${t.term} ${t.defs.map((d) => d.text).join(' ')}`, words);
    });
  }, [g.data, words, section]);

  /* переход к термину из поиска */
  useEffect(() => {
    if (!focus || !g.data) return;
    const key = g.data.terms.find((t) => fold(t.term) === fold(focus))?.key;
    if (!key) return;
    const t = setTimeout(() => document.getElementById(`t-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    return () => clearTimeout(t);
  }, [focus, g.data]);

  const letters = useMemo(() => [...new Set(shown.map((t) => t.letter))], [shown]);
  const cards = useMemo(() => shown.map((t) => ({ term: t.term, definition: t.defs[0]!.text })), [shown]);

  return (
    <Async state={g}>
      {(data) => (
        <>
          <PageHead
            kicker="Словарь терминов курса"
            title={data.course.title}
            back={
              <Link to={`/learn/${data.course.id}`} className="back">
                <Icon name="arrow-left" size={16} /> Курс
              </Link>
            }
          >
            <Button icon="print" onClick={() => print()}>
              Распечатать
            </Button>
          </PageHead>
          <p className="muted gloss-lead">
            {data.terms.length} {plural(data.terms.length, ['термин', 'термина', 'терминов'])} из лекций курса. У каждого определения указана тема, где термин объясняется: нажмите, чтобы перейти к лекции.
          </p>

          <div className="toolbar gloss-tools">
            <input className="input toolbar__search" type="search" placeholder="Найти термин или слово в определении" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по словарю" />
            {data.sections.length > 1 && (
              <select className="input input--inline" value={section} onChange={(e) => setSection(e.target.value)} aria-label="Раздел курса">
                <option value="">Все разделы</option>
                {data.sections.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <div className="seg" role="radiogroup" aria-label="Вид словаря">
              {(
                [
                  ['list', 'Список'],
                  ['cards', 'Карточки'],
                  ['drill', 'Тренажёр'],
                ] as [Mode, string][]
              ).map(([m, label]) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={`seg__btn ${mode === m ? 'is-on' : ''}`} onClick={() => setMode(m)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <section className="card">
              <Empty title={data.terms.length ? 'Ничего не найдено' : 'В лекциях курса пока нет терминов'} text={data.terms.length ? 'Измените запрос или выберите другой раздел.' : 'Термины появляются здесь, когда в лекцию добавлен блок «Термин словаря».'} />
            </section>
          ) : mode === 'cards' ? (
            <section className="card">
              <p className="muted">Нажмите на карточку, чтобы увидеть определение. Карточек: {cards.length}.</p>
              <TermCards terms={cards} />
            </section>
          ) : mode === 'drill' ? (
            <section className="card">
              {cards.length >= 4 ? (
                <>
                  <p className="muted">Тренажёр берёт шесть случайных терминов из {section ? 'выбранного раздела' : 'словаря'}: по определению выберите термин.</p>
                  <TermQuiz key={`${section}:${q}`} terms={cards} />
                </>
              ) : (
                <Empty title="Для тренажёра нужно не меньше четырёх терминов" text="Уберите фильтр или выберите другой раздел." />
              )}
            </section>
          ) : (
            <>
              {/* указатель по буквам */}
              <nav className="abc" aria-label="Указатель по буквам">
                {data.letters.map((l) => (
                  <button key={l} type="button" className="abc__l" disabled={!letters.includes(l)} onClick={() => document.getElementById(`L-${l}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    {l}
                  </button>
                ))}
              </nav>
              <div className="gloss">
                {letters.map((l) => (
                  <section key={l} id={`L-${l}`} className="gloss__group">
                    <h2 className="gloss__letter">{l}</h2>
                    <dl className="gloss__list">
                      {shown
                        .filter((t) => t.letter === l)
                        .map((t) => (
                          <div key={t.key} id={`t-${t.key}`} className={`gloss__item ${focus && fold(t.term) === fold(focus) ? 'is-focus' : ''}`}>
                            <dt className="gloss__term">
                              <Hl text={t.term} words={words} />
                            </dt>
                            {t.defs.map((d, i) => (
                              <dd key={i} className="gloss__def">
                                <p>
                                  <Hl text={d.text} words={words} />
                                </p>
                                <p className="gloss__where">
                                  {d.locked ? (
                                    <span title="Тема откроется после сдачи теста предыдущей темы">
                                      <Icon name="lock" size={14} /> Тема {d.moduleNo}. {d.module}
                                    </span>
                                  ) : (
                                    <Link to={itemLink('lecture', d.lectureId)}>
                                      <Icon name="lecture" size={14} /> Тема {d.moduleNo}. {d.module}
                                    </Link>
                                  )}
                                </p>
                              </dd>
                            ))}
                          </div>
                        ))}
                    </dl>
                  </section>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Async>
  );
};
