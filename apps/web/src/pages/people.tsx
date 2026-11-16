/* люди и роли: директор добавляет, изменяет, блокирует и удаляет пользователей */
import { useState } from 'react';
import { ROLE_LABEL, assignableRoles, canManageUser, fullName, type Group, type Institution, type PublicUser, type Role, type User } from '@pc/core';
import { useApp } from '../lib/app.tsx';
import { fmtDateTime } from '../lib/format.ts';
import { useAction, useLoad } from '../lib/hooks.ts';
import { Async, Badge, Button, Empty, Field, Modal, PageHead } from '../ui/ui.tsx';

type Row = PublicUser & { groups: { id: string; name: string }[] };

const blankForm = { role: 'student' as Role, lastName: '', firstName: '', middleName: '', login: '', email: '', groupId: '', institutionId: '', password: '' };

export const PeoplePage = () => {
  const { client, user, confirm } = useApp();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [groupId, setGroupId] = useState('');
  const list = useLoad(() => client.call<Row[]>('GET', '/users', undefined, { role, q, groupId }), [role, q, groupId]);
  const groups = useLoad(() => client.call<Group[]>('GET', '/groups'), []);
  const insts = useLoad(() => (user?.role === 'owner' ? client.call<Institution[]>('GET', '/institutions') : Promise.resolve([])), []);
  const [form, setForm] = useState<typeof blankForm | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [secret, setSecret] = useState<{ name: string; login: string; password: string } | null>(null);
  const { busy, run } = useAction();
  if (!user) return null;
  const me = user as unknown as User;
  const roles = assignableRoles(me);

  const create = async () => {
    if (!form) return;
    const r = await run(() => client.call<{ user: PublicUser; tempPassword: string | null }>('POST', '/users', { ...form, password: form.password || undefined }), 'Пользователь добавлен');
    if (!r) return;
    setForm(null);
    list.reload();
    if (r.tempPassword) setSecret({ name: fullName(r.user), login: r.user.login, password: r.tempPassword });
  };

  const save = async () => {
    if (!edit) return;
    const r = await run(() => client.call('PATCH', `/users/${edit.id}`, { lastName: edit.lastName, firstName: edit.firstName, middleName: edit.middleName, login: edit.login, email: edit.email, role: edit.role, status: edit.status }), 'Изменения сохранены');
    if (r) {
      setEdit(null);
      list.reload();
    }
  };

  const remove = async (u: Row) => {
    if (!(await confirm({ text: `Удалить ${fullName(u)}? Учётная запись попадёт в корзину на 30 дней, её можно будет восстановить.`, ok: 'Удалить', danger: true }))) return;
    if (await run(() => client.call('DELETE', `/users/${u.id}`), 'Перемещено в корзину')) list.reload();
  };

  const reset = async (u: Row) => {
    if (!(await confirm({ text: `Сбросить пароль для ${fullName(u)}? Будет выдан временный пароль, старые сессии завершатся.`, ok: 'Сбросить' }))) return;
    const r = await run(() => client.call<{ tempPassword: string }>('POST', `/users/${u.id}/reset-password`));
    if (r) setSecret({ name: fullName(u), login: u.login, password: r.tempPassword });
  };

  const toggleBlock = async (u: Row) => {
    const next = u.status === 'active' ? 'blocked' : 'active';
    if (next === 'blocked' && !(await confirm({ text: `Заблокировать ${fullName(u)}? Пользователь не сможет войти.`, ok: 'Заблокировать', danger: true }))) return;
    if (await run(() => client.call('PATCH', `/users/${u.id}`, { status: next }), next === 'blocked' ? 'Заблокирован' : 'Разблокирован')) list.reload();
  };

  return (
    <>
      <PageHead kicker="Управление учреждением" title="Люди и роли">
        {roles.length > 0 && (
          <Button kind="primary" icon="plus" onClick={() => setForm({ ...blankForm, role: roles.includes('student') ? 'student' : roles[0]! })}>
            Добавить
          </Button>
        )}
      </PageHead>

      {/* фильтры */}
      <div className="filters">
        <Field label="Поиск">{(id) => <input id={id} className="input" type="search" placeholder="Фамилия, логин, почта" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Field label="Роль">
          {(id) => (
            <select id={id} className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Все роли</option>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Группа">
          {(id) => (
            <select id={id} className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Все</option>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Async state={list}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="Никого не найдено" text="Измените условия поиска." />
          ) : (
            <div className="table-wrap">
              <table className="table table--cards">
                <caption className="visually-hidden">Пользователи учреждения</caption>
                <thead>
                  <tr>
                    <th>ФИО</th>
                    <th>Роль</th>
                    <th>Группа</th>
                    <th>Логин</th>
                    <th>Последний вход</th>
                    <th>
                      <span className="visually-hidden">Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const manage = canManageUser(me, u);
                    return (
                      <tr key={u.id} className={u.status === 'blocked' ? 'is-muted' : ''}>
                        <td data-label="ФИО">
                          <strong>{fullName(u)}</strong>
                          {u.status === 'blocked' && <Badge tone="err">заблокирован</Badge>}
                          {u.id === user.id && <Badge tone="info">это вы</Badge>}
                        </td>
                        <td data-label="Роль">{ROLE_LABEL[u.role]}</td>
                        <td data-label="Группа">{u.groups.map((g) => g.name).join(', ') || '—'}</td>
                        <td data-label="Логин">
                          <code>{u.login}</code>
                        </td>
                        <td data-label="Вход">{fmtDateTime(u.lastLoginAt)}</td>
                        <td className="table__actions">
                          {manage && (
                            <>
                              <Button size="sm" kind="ghost" icon="edit" onClick={() => setEdit(u)} aria-label={`Изменить: ${fullName(u)}`} />
                              <Button size="sm" kind="ghost" icon="key" onClick={() => void reset(u)} aria-label="Сбросить пароль" title="Сбросить пароль" />
                              <Button size="sm" kind="ghost" icon="lock" onClick={() => void toggleBlock(u)} aria-label={u.status === 'active' ? 'Заблокировать' : 'Разблокировать'} title={u.status === 'active' ? 'Заблокировать' : 'Разблокировать'} />
                              <Button size="sm" kind="ghost" icon="trash" onClick={() => void remove(u)} aria-label="Удалить" title="Удалить" />
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>

      {/* добавление */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Новый пользователь"
        footer={
          <>
            <Button onClick={() => setForm(null)}>Отмена</Button>
            <Button kind="primary" busy={busy} onClick={() => void create()}>
              Добавить
            </Button>
          </>
        }
      >
        {form && (
          <div className="form">
            {user.role === 'owner' && (
              <Field label="Учреждение">
                {(id) => (
                  <select id={id} className="input" value={form.institutionId} onChange={(e) => setForm({ ...form, institutionId: e.target.value })}>
                    <option value="">Выберите</option>
                    {insts.data?.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.shortName}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="Роль">
              {(id) => (
                <select id={id} className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="form__row">
              <Field label="Фамилия">{(id) => <input id={id} className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />}</Field>
              <Field label="Имя">{(id) => <input id={id} className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />}</Field>
            </div>
            <Field label="Отчество">{(id) => <input id={id} className="input" value={form.middleName} onChange={(e) => setForm({ ...form, middleName: e.target.value })} />}</Field>
            <div className="form__row">
              <Field label="Логин" hint="латиница и цифры">
                {(id) => <input id={id} className="input" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />}
              </Field>
              <Field label="Электронная почта">{(id) => <input id={id} className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
            </div>
            {form.role === 'student' && (
              <Field label="Группа">
                {(id) => (
                  <select id={id} className="input" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                    <option value="">Без группы</option>
                    {groups.data?.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="Пароль" hint="Оставьте пустым — будет выдан временный пароль, который нужно сменить при входе">
              {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
            </Field>
          </div>
        )}
      </Modal>

      {/* изменение */}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Изменить пользователя"
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Отмена</Button>
            <Button kind="primary" busy={busy} onClick={() => void save()}>
              Сохранить
            </Button>
          </>
        }
      >
        {edit && (
          <div className="form">
            <div className="form__row">
              <Field label="Фамилия">{(id) => <input id={id} className="input" value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} />}</Field>
              <Field label="Имя">{(id) => <input id={id} className="input" value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} />}</Field>
            </div>
            <Field label="Отчество">{(id) => <input id={id} className="input" value={edit.middleName} onChange={(e) => setEdit({ ...edit, middleName: e.target.value })} />}</Field>
            <div className="form__row">
              <Field label="Логин">{(id) => <input id={id} className="input" value={edit.login} onChange={(e) => setEdit({ ...edit, login: e.target.value })} />}</Field>
              <Field label="Почта">{(id) => <input id={id} className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />}</Field>
            </div>
            <Field label="Роль" hint="Роль меняется сразу, при следующем действии у пользователя изменятся права">
              {(id) => (
                <select id={id} className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>
                  {[edit.role, ...roles.filter((r) => r !== edit.role)].map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        )}
      </Modal>

      {/* временный пароль */}
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Временный пароль" footer={<Button kind="primary" onClick={() => setSecret(null)}>Готово</Button>}>
        {secret && (
          <div className="secret">
            <p>Передайте данные для входа пользователю {secret.name}. Пароль показывается один раз, при первом входе его нужно сменить.</p>
            <dl className="secret__list">
              <dt>Логин</dt>
              <dd>
                <code>{secret.login}</code>
              </dd>
              <dt>Пароль</dt>
              <dd>
                <code>{secret.password}</code>
              </dd>
            </dl>
            <Button icon="copy" onClick={() => void navigator.clipboard?.writeText(`Логин: ${secret.login}\nПароль: ${secret.password}`)}>
              Скопировать
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
};
