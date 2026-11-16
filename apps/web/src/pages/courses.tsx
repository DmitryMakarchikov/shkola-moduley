/* курсы: список, создание, дерево разделов и модулей, статусы, назначение группам */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { fullName, type Course, type CourseStatus, type Discipline, type PublicUser } from '@pc/core';
import { useApp } from '../lib/app.tsx';
import { COURSE_STATUS, fmtDate, toInputDate } from '../lib/format.ts';
import { useAction, useLoad } from '../lib/hooks.ts';
import { Async, Badge, Button, Empty, Field, Icon, Modal, PageHead, Tabs } from '../ui/ui.tsx';

type CourseRow = Course & { authorName: string; disciplineName: string; moduleCount: number; canEdit: boolean; canReview: boolean };

/* новая дисциплина прямо из окна создания курса */
const NewDiscipline = ({ institutionId, startOpen, onCreated }: { institutionId?: string; startOpen: boolean; onCreated: (d: Discipline) => void }) => {
  const { client, user } = useApp();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const insts = useLoad(() => (user?.role === 'owner' ? client.call<{ id: string; shortName: string }[]>('GET', '/institutions') : Promise.resolve([])), []);
  const [inst, setInst] = useState('');
  const { busy, run } = useAction();
  if (!open) {
    return (
      <Button size="sm" kind="ghost" icon="plus" className="inline-add__open" onClick={() => setOpen(true)}>
        Новая дисциплина
      </Button>
    );
  }
  const target = inst || institutionId || insts.data?.[0]?.id;
  return (
    <div className="inline-add">
      <p className="inline-add__title">Новая дисциплина</p>
      <div className="form__row">
        <Field label="Название">{(id) => <input id={id} className="input" placeholder="Например, Базы данных" value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Сокращение" hint="Необязательно">{(id) => <input id={id} className="input" placeholder="БД" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
      </div>
      {(insts.data?.length ?? 0) > 1 && (
        <Field label="Учреждение">
          {(id) => (
            <select id={id} className="input" value={target} onChange={(e) => setInst(e.target.value)}>
              {insts.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.shortName}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <div className="actions">
        <Button
          kind="primary"
          size="sm"
          busy={busy}
          disabled={!name.trim()}
          onClick={async () => {
            const d = await run(() => client.call<Discipline>('POST', '/disciplines', { name, code, institutionId: user?.role === 'owner' ? target : undefined }), 'Дисциплина добавлена');
            if (d) {
              onCreated(d);
              setName('');
              setCode('');
              setOpen(false);
            }
          }}
        >
          Добавить
        </Button>
        <Button size="sm" kind="ghost" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </div>
  );
};

export const CoursesPage = () => {
  const { client, user } = useApp();
  const [status, setStatus] = useState<'' | CourseStatus>('');
  const list = useLoad(() => client.call<CourseRow[]>('GET', '/courses', undefined, { status }), [status]);
  const discs = useLoad(() => client.call<Discipline[]>('GET', '/disciplines'), []);
  const teachers = useLoad(() => (user?.role === 'director' || user?.role === 'owner' ? client.call<PublicUser[]>('GET', '/users', undefined, { role: 'teacher' }) : Promise.resolve([])), []);
  const [form, setForm] = useState<{ disciplineId: string; title: string; description: string; authorId: string } | null>(null);
  const { busy, run } = useAction();
  const nav = useNavigate();
  const canCreate = user?.role === 'teacher' || user?.role === 'director' || user?.role === 'owner';
  const canAddDisc = user?.role === 'owner' || user?.role === 'director' || user?.role === 'methodist';

  return (
    <>
      <PageHead kicker="Учебный контент" title="Курсы">
        {canCreate && (
          <Button kind="primary" icon="plus" onClick={() => setForm({ disciplineId: discs.data?.[0]?.id ?? '', title: '', description: '', authorId: '' })}>
            Новый курс
          </Button>
        )}
      </PageHead>
      <Tabs
        value={status}
        onChange={setStatus}
        items={[
          { id: '' as const, label: 'Все' },
          { id: 'draft' as const, label: 'Черновики' },
          { id: 'review' as const, label: 'На проверке' },
          { id: 'published' as const, label: 'Опубликованы' },
          { id: 'archived' as const, label: 'Архив' },
        ]}
      />
      <Async state={list}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="Курсов нет" text={canCreate ? 'Создайте первый курс: разделы, модули, лекции, тесты и лабораторные работы.' : undefined} />
          ) : (
            <div className="cards">
              {rows.map((c) => (
                <Link key={c.id} to={`/courses/${c.id}`} className="tile tile--course">
                  <span className="tile__top">
                    <Badge tone={COURSE_STATUS[c.status].tone}>{COURSE_STATUS[c.status].label}</Badge>
                    <span className="tile__meta">{c.disciplineName}</span>
                  </span>
                  <span className="tile__title">{c.title}</span>
                  <span className="tile__text">{c.description || 'Без описания'}</span>
                  <span className="tile__meta">
                    {c.moduleCount} мод. · автор: {c.authorName} · изменён {fmtDate(c.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          )
        }
      </Async>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Новый курс"
        footer={
          <>
            <Button onClick={() => setForm(null)}>Отмена</Button>
            <Button
              kind="primary"
              busy={busy}
              onClick={async () => {
                const c = await run(() => client.call<Course>('POST', '/courses', { ...form, authorId: form?.authorId || undefined }), 'Курс создан');
                if (c) nav(`/courses/${c.id}`);
              }}
            >
              Создать
            </Button>
          </>
        }
      >
        {form && (
          <div className="form">
            <Field label="Дисциплина" hint={canAddDisc ? undefined : 'Нет нужной дисциплины? Её добавляет методист или директор.'}>
              {(id) =>
                (discs.data?.length ?? 0) > 0 ? (
                  <select id={id} className="input" value={form.disciplineId} onChange={(e) => setForm({ ...form, disciplineId: e.target.value })}>
                    {discs.data?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p id={id} className="muted">
                    Дисциплин пока нет — добавьте первую.
                  </p>
                )
              }
            </Field>
            {canAddDisc && (
              <NewDiscipline
                institutionId={discs.data?.find((d) => d.id === form.disciplineId)?.institutionId}
                startOpen={(discs.data?.length ?? 0) === 0}
                onCreated={(d) => {
                  discs.reload();
                  setForm({ ...form, disciplineId: d.id });
                }}
              />
            )}
            <Field label="Название курса">{(id) => <input id={id} className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
            <Field label="Описание">{(id) => <textarea id={id} className="input textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
            {(teachers.data?.length ?? 0) > 0 && (
              <Field label="Автор курса" hint="Преподаватель, который будет вести курс">
                {(id) => (
                  <select id={id} className="input" value={form.authorId} onChange={(e) => setForm({ ...form, authorId: e.target.value })}>
                    <option value="">Я — автор курса</option>
                    {teachers.data?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {fullName(t)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>
        )}
      </Modal>
    </>
  );
};

/* ---------- страница курса ---------- */
interface ItemRef {
  id: string;
  title: string;
}
interface ModRow {
  id: string;
  title: string;
  hours: number;
  lectures: ItemRef[];
  tests: ItemRef[];
  labs: ItemRef[];
}
interface CourseFull extends Course {
  disciplineName: string;
  authorName: string;
  canEdit: boolean;
  canReview: boolean;
  sections: { id: string; title: string; modules: ModRow[] }[];
}
interface AssignmentRow {
  id: string;
  groupId: string;
  groupName: string;
  teacherName: string;
  dueDates: Record<string, string>;
}

export const CoursePage = () => {
  const { id = '' } = useParams();
  const { client, user, confirm } = useApp();
  const nav = useNavigate();
  const course = useLoad(() => client.call<CourseFull>('GET', `/courses/${id}`), [id]);
  const assigns = useLoad(() => client.call<AssignmentRow[]>('GET', '/assignments', undefined, { courseId: id }), [id]);
  const groups = useLoad(() => client.call<{ id: string; name: string }[]>('GET', '/groups'), []);
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<{ title: string; description: string } | null>(null);
  const [newItem, setNewItem] = useState<{ kind: 'section' | 'module'; parent: string; title: string } | null>(null);
  const [reject, setReject] = useState<string | null>(null);
  const [assign, setAssign] = useState<{ id?: string; groupId: string; dueDates: Record<string, string> } | null>(null);

  const status = async (action: string, comment?: string) => {
    const labels: Record<string, string> = { submit: 'Отправлено на проверку', approve: 'Курс опубликован', reject: 'Возвращено на доработку', publish: 'Курс опубликован', archive: 'Курс в архиве', restore: 'Курс восстановлен' };
    if (await run(() => client.call('POST', `/courses/${id}/status`, { action, comment }), labels[action])) course.reload();
  };

  const move = async (kind: 'sections' | 'modules', itemId: string, direction: 'up' | 'down') => {
    if (await run(() => client.call('POST', `/${kind}/${itemId}/move`, { direction }))) course.reload();
  };

  return (
    <Async state={course}>
      {(c) => {
        const allItems = c.sections.flatMap((s) => s.modules.flatMap((m) => [...m.tests.map((t) => ({ ...t, kind: 'Тест', module: m.title })), ...m.labs.map((l) => ({ ...l, kind: 'Лабораторная', module: m.title }))]));
        const admin = user?.role === 'director' || user?.role === 'owner';
        return (
          <>
            <PageHead kicker={c.disciplineName} title={c.title} back={<Link to="/courses" className="back"><Icon name="arrow-left" size={16} /> Курсы</Link>}>
              <Badge tone={COURSE_STATUS[c.status].tone}>{COURSE_STATUS[c.status].label}</Badge>
              <Link to={`/learn/${c.id}`} className="btn">
                <Icon name="eye" size={18} />
                <span>Глазами учащегося</span>
              </Link>
            </PageHead>

            {c.reviewComment && c.status === 'draft' && (
              <div className="note note--warn">
                <strong>Замечание методиста:</strong> {c.reviewComment}
              </div>
            )}

            {/* действия со статусом */}
            <div className="actions">
              {c.canEdit && c.status === 'draft' && (
                <Button kind="primary" icon="send" busy={busy} onClick={() => void status('submit')}>
                  Отправить на проверку
                </Button>
              )}
              {c.canReview && c.status === 'review' && (
                <>
                  <Button kind="success" icon="check" busy={busy} onClick={() => void status('approve')}>
                    Утвердить и опубликовать
                  </Button>
                  <Button onClick={() => setReject('')}>Вернуть на доработку</Button>
                </>
              )}
              {admin && c.status === 'draft' && (
                <Button busy={busy} onClick={() => void status('publish')}>
                  Опубликовать без проверки
                </Button>
              )}
              {c.canEdit && <Button icon="edit" onClick={() => setEdit({ title: c.title, description: c.description })}>Описание</Button>}
              {(user?.role === 'teacher' || admin) && (
                <Button
                  icon="copy"
                  busy={busy}
                  onClick={async () => {
                    const copy = await run(() => client.call<Course>('POST', `/courses/${c.id}/duplicate`), 'Создана копия курса');
                    if (copy) nav(`/courses/${copy.id}`);
                  }}
                >
                  Копия
                </Button>
              )}
              {c.status !== 'archived' && (c.canEdit || admin) && c.status === 'published' && (
                <Button busy={busy} onClick={() => void status('archive')}>
                  В архив
                </Button>
              )}
              {admin && c.status === 'archived' && (
                <Button busy={busy} onClick={() => void status('restore')}>
                  Вернуть из архива
                </Button>
              )}
              {c.canEdit && (
                <Button
                  kind="danger"
                  icon="trash"
                  busy={busy}
                  onClick={async () => {
                    if (!(await confirm({ text: 'Удалить курс? Если по нему уже есть результаты учащихся, он будет переведён в архив.', ok: 'Удалить', danger: true }))) return;
                    const r = await run(() => client.call<{ archived: boolean }>('DELETE', `/courses/${c.id}`));
                    if (r) nav('/courses');
                  }}
                >
                  Удалить
                </Button>
              )}
            </div>

            <div className="grid grid--side">
              {/* разделы и модули */}
              <section className="card">
                <div className="card__head">
                  <h2 className="card__title">Разделы и модули</h2>
                  {c.canEdit && (
                    <Button size="sm" icon="plus" onClick={() => setNewItem({ kind: 'section', parent: c.id, title: '' })}>
                      Раздел
                    </Button>
                  )}
                </div>
                {c.description && <p className="muted">{c.description}</p>}
                {c.sections.length === 0 && <Empty title="Разделов пока нет" text="Курс делится на разделы, раздел — на модули. Один модуль — одна тема учебной программы." />}
                <ol className="tree">
                  {c.sections.map((s, si) => (
                    <li key={s.id} className="tree__section">
                      <div className="tree__head">
                        <span className="tree__title">
                          Раздел {si + 1}. {s.title}
                        </span>
                        {c.canEdit && (
                          <span className="tree__actions">
                            <Button size="sm" kind="ghost" icon="up" aria-label="Выше" onClick={() => void move('sections', s.id, 'up')} />
                            <Button size="sm" kind="ghost" icon="down" aria-label="Ниже" onClick={() => void move('sections', s.id, 'down')} />
                            <Button size="sm" kind="ghost" icon="plus" aria-label="Добавить модуль" title="Добавить модуль" onClick={() => setNewItem({ kind: 'module', parent: s.id, title: '' })} />
                            <Button
                              size="sm"
                              kind="ghost"
                              icon="trash"
                              aria-label="Удалить раздел"
                              onClick={async () => {
                                if (await confirm({ text: `Удалить раздел «${s.title}» вместе с модулями? Их можно будет восстановить из корзины.`, ok: 'Удалить', danger: true })) {
                                  if (await run(() => client.call('DELETE', `/sections/${s.id}`), 'Раздел в корзине')) course.reload();
                                }
                              }}
                            />
                          </span>
                        )}
                      </div>
                      <ol className="tree__modules">
                        {s.modules.map((m, mi) => (
                          <li key={m.id} className="tree__module">
                            <Link to={`/modules/${m.id}`} className="tree__link">
                              <span className="tree__num">{mi + 1}</span>
                              <span className="tree__mtitle">{m.title}</span>
                              <span className="tree__counts">
                                <span title="Лекции">
                                  <Icon name="lecture" size={16} /> {m.lectures.length}
                                </span>
                                <span title="Тесты">
                                  <Icon name="test" size={16} /> {m.tests.length}
                                </span>
                                <span title="Лабораторные работы">
                                  <Icon name="lab" size={16} /> {m.labs.length}
                                </span>
                              </span>
                            </Link>
                            {c.canEdit && (
                              <span className="tree__actions">
                                <Button size="sm" kind="ghost" icon="up" aria-label="Выше" onClick={() => void move('modules', m.id, 'up')} />
                                <Button size="sm" kind="ghost" icon="down" aria-label="Ниже" onClick={() => void move('modules', m.id, 'down')} />
                              </span>
                            )}
                          </li>
                        ))}
                        {s.modules.length === 0 && <li className="tree__empty">Модулей пока нет</li>}
                      </ol>
                    </li>
                  ))}
                </ol>
              </section>

              {/* назначение группам */}
              <aside className="card">
                <div className="card__head">
                  <h2 className="card__title">Группы</h2>
                  {c.status === 'published' && user?.role !== 'methodist' && (
                    <Button size="sm" icon="plus" onClick={() => setAssign({ groupId: groups.data?.[0]?.id ?? '', dueDates: {} })}>
                      Назначить
                    </Button>
                  )}
                </div>
                {c.status !== 'published' && <p className="muted">Назначить группе можно опубликованный курс.</p>}
                <Async state={assigns}>
                  {(rows) =>
                    rows.length === 0 ? (
                      <Empty title="Курс пока не назначен" />
                    ) : (
                      <ul className="rows">
                        {rows.map((a) => (
                          <li key={a.id} className="rows__item">
                            <span className="rows__title">{a.groupName}</span>
                            <span className="rows__meta">
                              {a.teacherName} · сроков: {Object.keys(a.dueDates).length}
                            </span>
                            {user?.role !== 'methodist' && (
                              <span className="rows__actions">
                                <Button size="sm" kind="ghost" icon="edit" aria-label="Сроки" onClick={() => setAssign({ id: a.id, groupId: a.groupId, dueDates: Object.fromEntries(Object.entries(a.dueDates).map(([k, v]) => [k, toInputDate(v)])) })} />
                                <Button
                                  size="sm"
                                  kind="ghost"
                                  icon="trash"
                                  aria-label="Снять назначение"
                                  onClick={async () => {
                                    if (await confirm({ text: `Снять курс с группы ${a.groupName}?`, ok: 'Снять', danger: true })) {
                                      if (await run(() => client.call('DELETE', `/assignments/${a.id}`), 'Назначение снято')) assigns.reload();
                                    }
                                  }}
                                />
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </Async>
                <dl className="props">
                  <dt>Автор</dt>
                  <dd>{c.authorName}</dd>
                  <dt>Создан</dt>
                  <dd>{fmtDate(c.createdAt)}</dd>
                </dl>
              </aside>
            </div>

            {/* описание */}
            <Modal
              open={!!edit}
              onClose={() => setEdit(null)}
              title="Название и описание"
              footer={
                <>
                  <Button onClick={() => setEdit(null)}>Отмена</Button>
                  <Button
                    kind="primary"
                    busy={busy}
                    onClick={async () => {
                      if (await run(() => client.call('PATCH', `/courses/${c.id}`, edit), 'Сохранено')) {
                        setEdit(null);
                        course.reload();
                      }
                    }}
                  >
                    Сохранить
                  </Button>
                </>
              }
            >
              {edit && (
                <div className="form">
                  <Field label="Название">{(fid) => <input id={fid} className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}</Field>
                  <Field label="Описание">{(fid) => <textarea id={fid} className="input textarea" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />}</Field>
                </div>
              )}
            </Modal>

            {/* новый раздел или модуль */}
            <Modal
              open={!!newItem}
              onClose={() => setNewItem(null)}
              title={newItem?.kind === 'section' ? 'Новый раздел' : 'Новый модуль'}
              footer={
                <>
                  <Button onClick={() => setNewItem(null)}>Отмена</Button>
                  <Button
                    kind="primary"
                    busy={busy}
                    onClick={async () => {
                      if (!newItem) return;
                      const path = newItem.kind === 'section' ? `/courses/${newItem.parent}/sections` : `/sections/${newItem.parent}/modules`;
                      const r = await run(() => client.call<{ id: string }>('POST', path, { title: newItem.title }), 'Добавлено');
                      if (r) {
                        setNewItem(null);
                        if (newItem.kind === 'module') nav(`/modules/${r.id}`);
                        else course.reload();
                      }
                    }}
                  >
                    Добавить
                  </Button>
                </>
              }
            >
              {newItem && (
                <Field label={newItem.kind === 'section' ? 'Название раздела' : 'Тема модуля'} hint={newItem.kind === 'module' ? 'Тема из учебной программы' : undefined}>
                  {(fid) => <input id={fid} className="input" value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} autoFocus />}
                </Field>
              )}
            </Modal>

            {/* возврат на доработку */}
            <Modal
              open={reject !== null}
              onClose={() => setReject(null)}
              title="Вернуть на доработку"
              footer={
                <>
                  <Button onClick={() => setReject(null)}>Отмена</Button>
                  <Button
                    kind="primary"
                    busy={busy}
                    onClick={async () => {
                      await status('reject', reject ?? '');
                      setReject(null);
                    }}
                  >
                    Вернуть
                  </Button>
                </>
              }
            >
              <Field label="Что исправить">{(fid) => <textarea id={fid} className="input textarea" value={reject ?? ''} onChange={(e) => setReject(e.target.value)} />}</Field>
            </Modal>

            {/* назначение */}
            <Modal
              open={!!assign}
              onClose={() => setAssign(null)}
              title={assign?.id ? 'Сроки сдачи' : 'Назначить курс группе'}
              wide
              footer={
                <>
                  <Button onClick={() => setAssign(null)}>Отмена</Button>
                  <Button
                    kind="primary"
                    busy={busy}
                    onClick={async () => {
                      if (!assign) return;
                      const dueDates = Object.fromEntries(Object.entries(assign.dueDates).filter(([, v]) => v).map(([k, v]) => [k, new Date(`${v}T23:59:00`).toISOString()]));
                      const ok = await run(
                        () => (assign.id ? client.call('PATCH', `/assignments/${assign.id}`, { dueDates }) : client.call('POST', '/assignments', { courseId: c.id, groupId: assign.groupId, dueDates })),
                        assign.id ? 'Сроки сохранены' : 'Курс назначен, учащиеся получили уведомление',
                      );
                      if (ok) {
                        setAssign(null);
                        assigns.reload();
                      }
                    }}
                  >
                    Сохранить
                  </Button>
                </>
              }
            >
              {assign && (
                <div className="form">
                  {!assign.id && (
                    <Field label="Группа">
                      {(fid) => (
                        <select id={fid} className="input" value={assign.groupId} onChange={(e) => setAssign({ ...assign, groupId: e.target.value })}>
                          {groups.data?.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  )}
                  <p className="muted">Сроки сдачи (необязательно). Работа, сданная позже срока, отмечается как просроченная.</p>
                  <div className="due-list">
                    {allItems.length === 0 && <p className="muted">В курсе пока нет тестов и лабораторных работ.</p>}
                    {allItems.map((it) => (
                      <Field key={it.id} label={`${it.kind}: ${it.title}`} hint={it.module}>
                        {(fid) => <input id={fid} className="input" type="date" value={assign.dueDates[it.id] ?? ''} onChange={(e) => setAssign({ ...assign, dueDates: { ...assign.dueDates, [it.id]: e.target.value } })} />}
                      </Field>
                    ))}
                  </div>
                </div>
              )}
            </Modal>
          </>
        );
      }}
    </Async>
  );
};
