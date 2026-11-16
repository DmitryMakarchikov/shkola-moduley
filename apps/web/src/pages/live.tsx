/* «Опрос на занятии»: экран преподавателя (для проектора) и экран учащегося (с телефона).
   Ответы приходят сразу (события сервера), баллов и рейтингов нет — только распределение ответов и разбор */
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useApp } from '../lib/app.tsx';
import { plural } from '../lib/format.ts';
import { useAction, useLoad } from '../lib/hooks.ts';
import { Async, Button, Empty, Field, Icon, Modal } from '../ui/ui.tsx';

interface LiveQ {
  id: string;
  type: 'single' | 'multi';
  text: string;
  options: string[];
  answer?: number[];
  explain?: string;
}
interface LiveView {
  id: string;
  title: string;
  group: string;
  teacher: string;
  index: number;
  total: number;
  reveal: boolean;
  finished: boolean;
  answered: number;
  members: number;
  joined: number;
  role: 'teacher' | 'student';
  question: LiveQ;
  counts: number[] | null;
  mine?: number[] | null;
  right?: boolean | null;
  summary: { n: number; text: string; answered: number; right: number; mine?: boolean | null }[] | null;
}

const LETTERS = 'АБВГДЕЖЗИК';

/* обновление по событию сервера: «live» с номером опроса */
const useLiveEvents = (id: string, reload: () => void) => {
  const { client } = useApp();
  useEffect(() => client.subscribe((e) => (e.type === 'live' && (e.data as { id?: string } | undefined)?.id === id) || e.type === 'resync' ? reload() : undefined), [client, id, reload]);
};

/* столбики ответов группы */
const Bars = ({ q, counts, showKey }: { q: LiveQ; counts: number[]; showKey: boolean }) => {
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);
  return (
    <ol className="live-bars">
      {q.options.map((o, i) => {
        const key = showKey && q.answer?.includes(i);
        return (
          <li key={i} className={`live-bars__row ${key ? 'is-key' : ''} ${showKey && !key ? 'is-dim' : ''}`}>
            <span className="live-bars__letter">{LETTERS[i]}</span>
            <span className="live-bars__text">{o}</span>
            <span className="live-bars__track">
              <span className="live-bars__fill" style={{ width: `${((counts[i] ?? 0) / max) * 100}%` }} />
            </span>
            <span className="live-bars__n">
              {counts[i] ?? 0}
              <small>{total ? ` · ${Math.round(((counts[i] ?? 0) / total) * 100)} %` : ''}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const Summary = ({ v }: { v: LiveView }) => (
  <section className="card live-sum">
    <h2 className="card__subtitle">Итоги опроса</h2>
    <table className="table">
      <thead>
        <tr>
          <th>№</th>
          <th>Вопрос</th>
          <th>Ответили</th>
          <th>Верно</th>
          {v.role === 'student' && <th>Мой ответ</th>}
        </tr>
      </thead>
      <tbody>
        {v.summary!.map((r) => (
          <tr key={r.n}>
            <td>{r.n}</td>
            <td>{r.text}</td>
            <td>{r.answered}</td>
            <td>{r.answered ? `${Math.round((r.right / r.answered) * 100)} %` : '—'}</td>
            {v.role === 'student' && <td>{r.mine === null || r.mine === undefined ? '—' : r.mine ? 'верно' : 'неверно'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);

/* экран преподавателя */
const Presenter = ({ v, reload }: { v: LiveView; reload: () => void }) => {
  const { client } = useApp();
  const { busy, run } = useAction();
  const [live, setLive] = useState(false);
  const act = async (action: string) => (await run(() => client.call('POST', `/live/${v.id}/control`, { action }))) && reload();
  const q = v.question;
  return (
    <div className="live live--presenter">
      <header className="live__head">
        <span className="live__badge">
          <Icon name="live" size={16} /> {v.finished ? 'Опрос завершён' : 'Опрос на занятии'}
        </span>
        <span className="live__meta">
          {v.group} · {v.title}
        </span>
        <span className="live__spacer" />
        {/* на весь экран — только опрос, без меню платформы: удобно для проектора */}
        <Button size="sm" kind="ghost" icon="expand" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : (document.querySelector('.live') as HTMLElement | null)?.requestFullscreen() ?? Promise.resolve()).catch(() => undefined)}>
          Во весь экран
        </Button>
      </header>
      {v.finished ? (
        <Summary v={v} />
      ) : (
        <section className="live__stage card">
          <p className="live__count">
            Вопрос {v.index + 1} из {v.total}
          </p>
          <h1 className="live__q">{q.text}</h1>
          <p className="live__hint">{q.type === 'multi' ? 'Несколько верных ответов' : 'Один верный ответ'}</p>
          {v.reveal || live ? (
            <Bars q={q} counts={v.counts ?? []} showKey={v.reveal} />
          ) : (
            <ol className="live-opts live-opts--static">
              {q.options.map((o, i) => (
                <li key={i}>
                  <span className="live-bars__letter">{LETTERS[i]}</span> {o}
                </li>
              ))}
            </ol>
          )}
          {v.reveal && q.explain && <p className="note note--info live__explain">{q.explain}</p>}
          <div className="live__progress">
            <span>
              Ответили <strong>{v.answered}</strong> из {v.members}
            </span>
            <span className="live__track">
              <span style={{ width: `${v.members ? (v.answered / v.members) * 100 : 0}%` }} />
            </span>
            <label className="check">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
              <span>показывать ответы до разбора</span>
            </label>
          </div>
        </section>
      )}
      <footer className="live__controls">
        {!v.finished && (
          <>
            <Button icon="arrow-left" disabled={busy || v.index === 0} onClick={() => void act('prev')}>
              Назад
            </Button>
            {!v.reveal ? (
              <Button kind="primary" icon="eye" busy={busy} onClick={() => void act('reveal')}>
                Показать правильный ответ
              </Button>
            ) : v.index < v.total - 1 ? (
              <Button kind="primary" busy={busy} onClick={() => void act('next')}>
                Следующий вопрос <Icon name="arrow-right" size={18} />
              </Button>
            ) : null}
            <Button kind="danger" disabled={busy} onClick={() => void act('finish')}>
              Завершить опрос
            </Button>
          </>
        )}
        {v.finished && (
          <Link to="/" className="btn">
            На главную
          </Link>
        )}
      </footer>
    </div>
  );
};

/* экран учащегося */
const Answering = ({ v, reload }: { v: LiveView; reload: () => void }) => {
  const { client } = useApp();
  const { busy, run } = useAction();
  const [pick, setPick] = useState<number[]>(v.mine ?? []);
  const q = v.question;
  useEffect(() => setPick(v.mine ?? []), [q.id, v.mine]);
  const send = async (answer: number[]) => (await run(() => client.call('POST', `/live/${v.id}/answer`, { questionId: q.id, answer }))) && reload();
  if (v.finished) return <Summary v={v} />;
  const sent = !!v.mine?.length;
  return (
    <div className="live live--student">
      <header className="live__head">
        <span className="live__badge">
          <Icon name="live" size={16} /> Опрос на занятии
        </span>
        <span className="live__meta">
          {v.teacher} · вопрос {v.index + 1} из {v.total}
        </span>
      </header>
      <section className="card live__stage">
        <h1 className="live__q live__q--small">{q.text}</h1>
        {!v.reveal && <p className="live__hint">{q.type === 'multi' ? 'Отметьте все верные ответы и нажмите «Ответить»' : 'Нажмите на ответ'}</p>}
        {v.reveal ? (
          <>
            <p className={`live__verdict ${v.right ? 'is-ok' : v.mine ? 'is-bad' : ''}`}>{v.mine ? (v.right ? 'Верно' : 'Неверно') : 'Вы не ответили на этот вопрос'}</p>
            <Bars q={q} counts={v.counts ?? []} showKey />
            {q.explain && <p className="note note--info">{q.explain}</p>}
            <p className="muted">Ждём следующий вопрос…</p>
          </>
        ) : (
          <>
            <div className="live-opts">
              {q.options.map((o, i) => {
                const on = pick.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    className={`live-opt ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => {
                      if (q.type === 'single') {
                        setPick([i]);
                        void send([i]);
                      } else setPick(on ? pick.filter((x) => x !== i) : [...pick, i]);
                    }}
                  >
                    <span className="live-bars__letter">{LETTERS[i]}</span>
                    <span>{o}</span>
                  </button>
                );
              })}
            </div>
            {q.type === 'multi' && (
              <Button kind="primary" className="btn--lg" busy={busy} disabled={!pick.length} onClick={() => void send(pick)}>
                Ответить
              </Button>
            )}
            {sent && <p className="live__sent">Ответ принят. Его можно изменить, пока преподаватель не покажет правильный ответ.</p>}
          </>
        )}
      </section>
    </div>
  );
};

export const LivePage = () => {
  const { id = '' } = useParams();
  const { client } = useApp();
  const v = useLoad(() => client.call<LiveView>('GET', `/live/${id}`), [id]);
  useLiveEvents(id, v.reload);
  /* учащийся сообщает, что подключился — преподаватель видит число подключившихся */
  useEffect(() => {
    if (v.data?.role === 'student') void client.call('POST', `/live/${id}/join`).catch(() => undefined);
  }, [client, id, v.data?.role]);
  return (
    <Async state={v}>
      {(data) => (data.role === 'teacher' ? <Presenter v={data} reload={v.reload} /> : <Answering v={data} reload={v.reload} />)}
    </Async>
  );
};

/* запуск опроса со страницы теста */
export const LiveStart = ({ testId, count }: { testId: string; count: number }) => {
  const { client } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState('');
  const groups = useLoad(() => (open ? client.call<{ id: string; name: string; students: number }[]>('GET', '/groups') : Promise.resolve([])), [open]);
  const { busy, run } = useAction();
  if (!count) return null;
  return (
    <>
      <Button icon="live" onClick={() => setOpen(true)} title="Вывести вопросы теста на экран и собрать ответы группы с телефонов">
        Опрос на занятии
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Опрос на занятии"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Отмена</Button>
            <Button
              kind="primary"
              icon="live"
              busy={busy}
              disabled={!groupId}
              onClick={async () => {
                const r = await run(() => client.call<{ id: string }>('POST', '/live', { testId, groupId }));
                if (r) nav(`/live/${r.id}`);
              }}
            >
              Начать опрос
            </Button>
          </>
        }
      >
        <p className="muted">
          На экране — вопрос теста, учащиеся группы отвечают со своих устройств: им придёт уведомление на сайте и в Telegram. Распределение ответов видно сразу, баллы не ставятся. В опросе {count} {plural(count, ['вопрос', 'вопроса', 'вопросов'])} с выбором ответа.
        </p>
        <Async state={groups}>
          {(list) =>
            list.length ? (
              <Field label="Группа">
                {(fid) => (
                  <select id={fid} className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                    <option value="">Выберите группу</option>
                    {list.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : (
              <Empty title="Групп нет" />
            )
          }
        </Async>
      </Modal>
    </>
  );
};

/* учащемуся: «идёт опрос» — над страницей, пока он не открыт */
export const LiveBanner = () => {
  const { client, user } = useApp();
  const loc = useLocation();
  const a = useLoad(() => client.call<{ live: { id: string; title: string; teacher: string; mine: boolean } | null }>('GET', '/live/active'), [loc.pathname]);
  useEffect(() => client.subscribe((e) => (e.type === 'live' || e.type === 'resync' ? a.reload() : undefined)), [client, a.reload]);
  /* баннер — только для настоящего идущего опроса (с номером и темой) */
  const s = a.data?.live;
  if (!s?.id || !s.title || loc.pathname.startsWith('/live/') || (user?.role !== 'student' && !s.mine)) return null;
  return (
    <Link to={`/live/${s.id}`} className="live-banner">
      <Icon name="live" size={18} />
      <span>
        {s.mine ? 'Идёт ваш опрос' : 'Идёт опрос на занятии'}: <strong>{s.title}</strong>
        {!s.mine && ` · ${s.teacher}`}
      </span>
      <span className="live-banner__go">{s.mine ? 'Вернуться к опросу' : 'Ответить'} →</span>
    </Link>
  );
};
