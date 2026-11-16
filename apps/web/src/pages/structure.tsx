/* структура учреждения: группы, отделения, дисциплины; учреждения для владельца */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { fullName, type Department, type Discipline, type Institution, type PublicUser } from '@pc/core';
import { useApp } from '../lib/app.tsx';
import { fmtCode } from '../lib/format.ts';
import { useAction, useLoad } from '../lib/hooks.ts';
import { Async, Badge, Button, Empty, Field, Icon, Modal, PageHead, Tabs } from '../ui/ui.tsx';

interface GroupRow {
  id: string;
  name: string;
  year: number;
  specialty: string;
  departmentId: string | null;
  curatorId: string | null;
  departmentName: string;
  curatorName: string;
  studentCount: number;
}

type Tab = 'groups' | 'departments' | 'disciplines';

export const StructurePage = () => {
  const { user } = useApp();
  const [tab, setTab] = useState<Tab>('groups');
  const admin = user?.role === 'director' || user?.role === 'owner';
  return (
    <>
      <PageHead kicker="Учреждение образования" title="Группы и отделения" />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'groups', label: 'Учебные группы' },
          { id: 'departments', label: 'Отделения' },
          { id: 'disciplines', label: 'Дисциплины' },
        ]}
      />
      {tab === 'groups' && <Groups admin={admin} />}
      {tab === 'departments' && <SimpleList admin={admin} path="/departments" noun="отделение" fields={[{ key: 'name', label: 'Наименование' }]} />}
      {tab === 'disciplines' && (
        <SimpleList
          admin={admin}
          path="/disciplines"
          noun="дисциплину"
          fields={[
            { key: 'name', label: 'Наименование' },
            { key: 'code', label: 'Сокращение' },
          ]}
        />
      )}
    </>
  );
};

/* ---------- группы ---------- */
const Groups = ({ admin }: { admin: boolean }) => {
  const { client, confirm } = useApp();
  const list = useLoad(() => client.call<GroupRow[]>('GET', '/groups'), []);
  const deps = useLoad(() => client.call<Department[]>('GET', '/departments'), []);
  const staff = useLoad(() => (admin ? client.call<PublicUser[]>('GET', '/users') : Promise.resolve([])), [admin]);
  const [form, setForm] = useState<Partial<GroupRow> | null>(null);
  const { busy, run } = useAction();

  const save = async () => {
    if (!form) return;
    const body = { name: form.name, year: Number(form.year ?? 1), specialty: form.specialty ?? '', departmentId: form.departmentId || null, curatorId: form.curatorId || null };
    const ok = await run(() => (form.id ? client.call('PATCH', `/groups/${form.id}`, body) : client.call('POST', '/groups', body)), 'Сохранено');
    if (ok) {
      setForm(null);
      list.reload();
    }
  };

  return (
    <section className="section">
      {admin && (
        <div className="section__bar">
          <Button kind="primary" icon="plus" onClick={() => setForm({ year: 1 })}>
            Новая группа
          </Button>
        </div>
      )}
      <Async state={list}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="Групп пока нет" />
          ) : (
            <div className="cards">
              {rows.map((g) => (
                <article key={g.id} className="tile">
                  <Link to={`/groups/${g.id}`} className="tile__link">
                    <span className="tile__title">{g.name}</span>
                    <span className="tile__meta">
                      {g.year} курс · {g.studentCount} уч.
                    </span>
                    <span className="tile__text">{g.specialty || 'Специальность не указана'}</span>
                    <span className="tile__meta">
                      {g.departmentName || 'Без отделения'} · куратор: {g.curatorName || '—'}
                    </span>
                  </Link>
                  {admin && (
                    <div className="tile__actions">
                      <Button size="sm" kind="ghost" icon="edit" onClick={() => setForm(g)} aria-label={`Изменить группу ${g.name}`} />
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="trash"
                        aria-label={`Удалить группу ${g.name}`}
                        onClick={async () => {
                          if (await confirm({ text: `Удалить группу ${g.name}? Она попадёт в корзину.`, ok: 'Удалить', danger: true })) {
                            if (await run(() => client.call('DELETE', `/groups/${g.id}`), 'Перемещено в корзину')) list.reload();
                          }
                        }}
                      />
                    </div>
                  )}
                </article>
              ))}
            </div>
          )
        }
      </Async>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Изменить группу' : 'Новая группа'}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Отмена</Button>
            <Button kind="primary" busy={busy} onClick={() => void save()}>
              Сохранить
            </Button>
          </>
        }
      >
        {form && (
          <div className="form">
            <div className="form__row">
              <Field label="Номер группы">{(id) => <input id={id} className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
              <Field label="Курс">{(id) => <input id={id} className="input" type="number" min={1} max={6} value={form.year ?? 1} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} />}</Field>
            </div>
            <Field label="Специальность">{(id) => <input id={id} className="input" value={form.specialty ?? ''} onChange={(e) => setForm({ ...form, specialty: e.target.value })} />}</Field>
            <Field label="Отделение">
              {(id) => (
                <select id={id} className="input" value={form.departmentId ?? ''} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">Без отделения</option>
                  {deps.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Куратор">
              {(id) => (
                <select id={id} className="input" value={form.curatorId ?? ''} onChange={(e) => setForm({ ...form, curatorId: e.target.value })}>
                  <option value="">Не назначен</option>
                  {staff.data
                    ?.filter((u) => u.role === 'teacher' || u.role === 'methodist' || u.role === 'director')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {fullName(u)}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          </div>
        )}
      </Modal>
    </section>
  );
};

/* ---------- простые справочники: отделения, дисциплины ---------- */
const SimpleList = ({ admin, path, noun, fields }: { admin: boolean; path: string; noun: string; fields: { key: string; label: string }[] }) => {
  const { client, confirm } = useApp();
  const list = useLoad(() => client.call<(Department | Discipline)[]>('GET', path), [path]);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const { busy, run } = useAction();
  const save = async () => {
    if (!form) return;
    const { id, ...body } = form;
    const ok = await run(() => (id ? client.call('PATCH', `${path}/${id}`, body) : client.call('POST', path, body)), 'Сохранено');
    if (ok) {
      setForm(null);
      list.reload();
    }
  };
  return (
    <section className="section">
      {admin && (
        <div className="section__bar">
          <Button kind="primary" icon="plus" onClick={() => setForm({})}>
            Добавить {noun}
          </Button>
        </div>
      )}
      <Async state={list}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="Список пуст" />
          ) : (
            <ul className="rows">
              {rows.map((r) => (
                <li key={r.id} className="rows__item">
                  <span className="rows__title">
                    {(r as unknown as Record<string, unknown>).name as string} {'code' in r && r.code ? <Badge>{r.code}</Badge> : null}
                  </span>
                  {admin && (
                    <span className="rows__actions">
                      <Button size="sm" kind="ghost" icon="edit" aria-label="Изменить" onClick={() => setForm(Object.fromEntries(['id', ...fields.map((f) => f.key)].map((k) => [k, String((r as unknown as Record<string, unknown>)[k] ?? '')])))} />
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="trash"
                        aria-label="Удалить"
                        onClick={async () => {
                          if (await confirm({ text: 'Удалить запись? Она попадёт в корзину.', ok: 'Удалить', danger: true })) {
                            if (await run(() => client.call('DELETE', `${path}/${r.id}`), 'Перемещено в корзину')) list.reload();
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
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Изменить' : `Добавить ${noun}`}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Отмена</Button>
            <Button kind="primary" busy={busy} onClick={() => void save()}>
              Сохранить
            </Button>
          </>
        }
      >
        {form && (
          <div className="form">
            {fields.map((f) => (
              <Field key={f.key} label={f.label}>
                {(id) => <input id={id} className="input" value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
              </Field>
            ))}
          </div>
        )}
      </Modal>
    </section>
  );
};

/* ---------- страница группы ---------- */
interface GroupFull extends GroupRow {
  joinCode: string;
  canManage: boolean;
  students: PublicUser[];
}

export const GroupPage = () => {
  const { id = '' } = useParams();
  const { client, confirm, toast } = useApp();
  const g = useLoad(() => client.call<GroupFull>('GET', `/groups/${id}`), [id]);
  const [adding, setAdding] = useState(false);
  const all = useLoad(() => (adding ? client.call<(PublicUser & { groups: { id: string }[] })[]>('GET', '/users', undefined, { role: 'student' }) : Promise.resolve([])), [adding]);
  const [picked, setPicked] = useState<string[]>([]);
  const { busy, run } = useAction();

  return (
    <Async state={g}>
      {(group) => (
        <>
          <PageHead kicker="Учебная группа" title={group.name} back={<Link to="/structure" className="back"><Icon name="arrow-left" size={16} /> Группы</Link>}>
            {group.canManage && (
              <Button kind="primary" icon="plus" onClick={() => (setPicked([]), setAdding(true))}>
                Добавить учащихся
              </Button>
            )}
          </PageHead>
          <div className="grid grid--side">
            <section className="card">
              <h2 className="card__title">Учащиеся ({group.students.length})</h2>
              {group.students.length === 0 ? (
                <Empty title="В группе пока нет учащихся" text="Добавьте их вручную или передайте код приглашения." />
              ) : (
                <ol className="rows">
                  {group.students.map((s) => (
                    <li key={s.id} className="rows__item">
                      <span className="rows__title">{fullName(s)}</span>
                      <span className="rows__meta">
                        <code>{s.login}</code>
                      </span>
                      {group.canManage && (
                        <span className="rows__actions">
                          <Button
                            size="sm"
                            kind="ghost"
                            icon="x"
                            aria-label={`Исключить ${fullName(s)} из группы`}
                            onClick={async () => {
                              if (await confirm({ text: `Исключить ${fullName(s)} из группы ${group.name}? Учётная запись сохранится.`, ok: 'Исключить', danger: true })) {
                                if (await run(() => client.call('DELETE', `/groups/${group.id}/students/${s.id}`), 'Исключён из группы')) g.reload();
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
            <aside className="card">
              <h2 className="card__title">О группе</h2>
              <dl className="props">
                <dt>Курс</dt>
                <dd>{group.year}</dd>
                <dt>Специальность</dt>
                <dd>{group.specialty || '—'}</dd>
                <dt>Отделение</dt>
                <dd>{group.departmentName || '—'}</dd>
                <dt>Куратор</dt>
                <dd>{group.curatorName || '—'}</dd>
              </dl>
              {group.canManage && (
                <div className="joincode">
                  <p className="joincode__label">Код приглашения</p>
                  <p className="joincode__value">{fmtCode(group.joinCode)}</p>
                  <p className="joincode__hint">Сообщите код только своей группе. Учащиеся вводят его на странице входа: «Есть код группы от куратора?». Если код попал к посторонним — выдайте новый, старый сразу перестанет действовать.</p>
                  <div className="joincode__actions">
                    <Button
                      size="sm"
                      icon="copy"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(fmtCode(group.joinCode));
                          toast('Код скопирован');
                        } catch {
                          toast('Не удалось скопировать — выделите код вручную', 'err');
                        }
                      }}
                    >
                      Скопировать
                    </Button>
                  <Button
                    size="sm"
                    icon="cycle"
                    busy={busy}
                    onClick={async () => {
                      if (await confirm({ text: 'Выдать новый код? Старый перестанет работать.', ok: 'Обновить код' })) {
                        if (await run(() => client.call('POST', `/groups/${group.id}/code`), 'Код обновлён')) g.reload();
                      }
                    }}
                  >
                    Новый код
                  </Button>
                  </div>
                </div>
              )}
            </aside>
          </div>
          <Modal
            open={adding}
            onClose={() => setAdding(false)}
            title="Добавить учащихся"
            wide
            footer={
              <>
                <Button onClick={() => setAdding(false)}>Отмена</Button>
                <Button
                  kind="primary"
                  busy={busy}
                  disabled={!picked.length}
                  onClick={async () => {
                    if (await run(() => client.call('POST', `/groups/${group.id}/students`, { studentIds: picked }), 'Учащиеся добавлены')) {
                      setAdding(false);
                      g.reload();
                    }
                  }}
                >
                  Добавить ({picked.length})
                </Button>
              </>
            }
          >
            <Async state={all}>
              {(rows) => {
                const free = rows.filter((s) => !group.students.some((m) => m.id === s.id));
                return free.length === 0 ? (
                  <Empty title="Нет учащихся вне группы" text="Новых учащихся добавляет директор на странице «Люди и роли»." />
                ) : (
                  <ul className="checks">
                    {free.map((s) => (
                      <li key={s.id}>
                        <label className="check">
                          <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                          <span>{fullName(s)}</span>
                          <span className="check__meta">{s.groups.length ? 'уже в другой группе' : 'без группы'}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                );
              }}
            </Async>
          </Modal>
        </>
      )}
    </Async>
  );
};

/* ---------- учреждения (владелец платформы) ---------- */
export const InstitutionsPage = () => {
  const { client, confirm } = useApp();
  const list = useLoad(() => client.call<Institution[]>('GET', '/institutions'), []);
  const [form, setForm] = useState<Partial<Institution> | null>(null);
  const { busy, run } = useAction();
  const save = async () => {
    if (!form) return;
    const body = { name: form.name, shortName: form.shortName, city: form.city };
    if (await run(() => (form.id ? client.call('PATCH', `/institutions/${form.id}`, body) : client.call('POST', '/institutions', body)), 'Сохранено')) {
      setForm(null);
      list.reload();
    }
  };
  return (
    <>
      <PageHead kicker="Платформа" title="Учреждения образования">
        <Button kind="primary" icon="plus" onClick={() => setForm({})}>
          Добавить
        </Button>
      </PageHead>
      <Async state={list}>
        {(rows) => (
          <ul className="rows">
            {rows.map((i) => (
              <li key={i.id} className="rows__item">
                <span className="rows__title">{i.name}</span>
                <span className="rows__meta">
                  {i.shortName} · {i.city}
                </span>
                <span className="rows__actions">
                  <Button size="sm" kind="ghost" icon="edit" aria-label="Изменить" onClick={() => setForm(i)} />
                  <Button
                    size="sm"
                    kind="ghost"
                    icon="trash"
                    aria-label="Удалить"
                    onClick={async () => {
                      if (await confirm({ text: `Удалить учреждение «${i.shortName}»?`, ok: 'Удалить', danger: true })) {
                        if (await run(() => client.call('DELETE', `/institutions/${i.id}`), 'Удалено')) list.reload();
                      }
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Async>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Изменить учреждение' : 'Новое учреждение'}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Отмена</Button>
            <Button kind="primary" busy={busy} onClick={() => void save()}>
              Сохранить
            </Button>
          </>
        }
      >
        {form && (
          <div className="form">
            <Field label="Полное наименование">{(id) => <input id={id} className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
            <div className="form__row">
              <Field label="Краткое наименование">{(id) => <input id={id} className="input" value={form.shortName ?? ''} onChange={(e) => setForm({ ...form, shortName: e.target.value })} />}</Field>
              <Field label="Город">{(id) => <input id={id} className="input" value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />}</Field>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
