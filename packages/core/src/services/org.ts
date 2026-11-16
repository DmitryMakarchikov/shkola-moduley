/* учреждения, пользователи, отделения, группы, дисциплины */
import {
  alive,
  audit,
  base,
  code,
  getAlive,
  needRole,
  needUser,
  softDelete,
  tempPassword,
  touch,
  type Ctx,
  joinCode,
} from '../context.ts';
import { bad, conflict, forbidden } from '../errors.ts';
import { fullName, publicUser, type Group, type Role, type User } from '../model.ts';
import { ROLE_LABEL, ROLES, assignableRoles, canManageUser, isStaff } from '../roles.ts';
import { idOf, int, login as loginOf, norm, obj, oneOf, optId, password, str } from '../validate.ts';

type Query = Record<string, string | undefined>;

const instOf = (actor: User, requested: unknown): string => {
  if (actor.role === 'owner') return idOf(requested, 'Учреждение');
  if (!actor.institutionId) throw forbidden();
  return actor.institutionId;
};

const dropSessions = async (ctx: Ctx, userId: string) => {
  for (const s of await ctx.repo.find('sessions', { userId })) await ctx.repo.remove('sessions', s.id);
};

const loginTaken = async (ctx: Ctx, login: string, exceptId?: string) =>
  (await ctx.repo.find('users', { login })).some((u) => !u.deletedAt && u.id !== exceptId);

/* ---------- учреждения ---------- */
export const listInstitutions = async (ctx: Ctx) => {
  const u = needUser(ctx);
  const all = alive(await ctx.repo.all('institutions'));
  return u.role === 'owner' ? all : all.filter((i) => i.id === u.institutionId);
};

export const createInstitution = async (ctx: Ctx, input: unknown) => {
  needRole(ctx, 'owner');
  const b = obj(input);
  const row = {
    ...base(ctx),
    name: str(b.name, 'Наименование', { max: 250 }),
    shortName: str(b.shortName, 'Краткое наименование', { max: 80 }),
    city: str(b.city, 'Город', { max: 80, optional: true }),
  };
  await ctx.repo.insert('institutions', row);
  await audit(ctx, 'create', 'institutions', row.id, `Учреждение «${row.shortName}»`, row.id);
  return row;
};

export const updateInstitution = async (ctx: Ctx, id: string, input: unknown) => {
  const u = needRole(ctx, 'owner', 'director');
  if (u.role === 'director' && u.institutionId !== id) throw forbidden();
  const cur = await getAlive(ctx, 'institutions', id, 'Учреждение');
  const b = obj(input);
  const row = await ctx.repo.update('institutions', id, {
    name: b.name !== undefined ? str(b.name, 'Наименование', { max: 250 }) : cur.name,
    shortName: b.shortName !== undefined ? str(b.shortName, 'Краткое наименование', { max: 80 }) : cur.shortName,
    city: b.city !== undefined ? str(b.city, 'Город', { max: 80, optional: true }) : cur.city,
    ...touch(ctx),
  });
  await audit(ctx, 'update', 'institutions', id, `Изменено учреждение «${row.shortName}»`, id);
  return row;
};

export const removeInstitution = async (ctx: Ctx, id: string) => {
  needRole(ctx, 'owner');
  const cur = await getAlive(ctx, 'institutions', id, 'Учреждение');
  await softDelete(ctx, 'institutions', id);
  await audit(ctx, 'delete', 'institutions', id, `Учреждение «${cur.shortName}» удалено в корзину`, id);
  return { ok: true };
};

/* ---------- пользователи ---------- */
export const listUsers = async (ctx: Ctx, query: Query = {}) => {
  const u = needRole(ctx, 'owner', 'director', 'methodist', 'teacher');
  let rows = alive(await ctx.repo.all('users'));
  if (u.role !== 'owner') rows = rows.filter((r) => r.institutionId === u.institutionId);
  else if (query.institutionId) rows = rows.filter((r) => r.institutionId === query.institutionId);
  if (query.role) rows = rows.filter((r) => r.role === query.role);
  const members = alive(await ctx.repo.all('groupMembers'));
  if (query.groupId) {
    const ids = new Set(members.filter((m) => m.groupId === query.groupId).map((m) => m.studentId));
    rows = rows.filter((r) => ids.has(r.id));
  }
  if (query.q) {
    const q = norm(query.q);
    rows = rows.filter((r) => norm(`${fullName(r)} ${r.login} ${r.email}`).includes(q));
  }
  const groups = new Map(alive(await ctx.repo.all('groups')).map((g) => [g.id, g]));
  return rows
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'))
    .map((r) => ({
      ...publicUser(r),
      groups: members
        .filter((m) => m.studentId === r.id)
        .map((m) => groups.get(m.groupId))
        .filter((g): g is Group => !!g)
        .map((g) => ({ id: g.id, name: g.name })),
    }));
};

export const createUser = async (ctx: Ctx, input: unknown) => {
  const actor = needRole(ctx, 'owner', 'director');
  const b = obj(input);
  const role = oneOf(b.role, 'Роль', ROLES);
  if (!assignableRoles(actor).includes(role)) throw forbidden('Эту роль вы назначить не можете');
  const institutionId = instOf(actor, b.institutionId);
  await getAlive(ctx, 'institutions', institutionId, 'Учреждение');
  const lg = loginOf(b.login);
  if (await loginTaken(ctx, lg)) throw conflict('Такой логин уже занят');
  const given = b.password ? password(b.password) : null;
  const pass = given ?? tempPassword();
  const user: User = {
    ...base(ctx),
    institutionId,
    role,
    login: lg,
    lastName: str(b.lastName, 'Фамилия', { max: 60 }),
    firstName: str(b.firstName, 'Имя', { max: 60 }),
    middleName: str(b.middleName, 'Отчество', { max: 60, optional: true }),
    email: str(b.email, 'Электронная почта', { max: 120, optional: true }),
    passwordHash: await ctx.hasher.hash(pass),
    status: 'active',
    mustChangePassword: !given,
    lastLoginAt: null,
    failedLogins: 0,
    lockedUntil: null,
  };
  await ctx.repo.tx(async () => {
    await ctx.repo.insert('users', user);
    const groupId = optId(b.groupId);
    if (groupId && role === 'student') {
      const g = await getAlive(ctx, 'groups', groupId, 'Группа');
      if (g.institutionId !== institutionId) throw bad('Группа из другого учреждения');
      await ctx.repo.insert('groupMembers', { ...base(ctx), groupId, studentId: user.id });
    }
    await audit(ctx, 'create', 'users', user.id, `${ROLE_LABEL[role]}: ${fullName(user)}`, institutionId);
  });
  return { user: publicUser(user), tempPassword: given ? null : pass };
};

export const updateUser = async (ctx: Ctx, id: string, input: unknown) => {
  const actor = needUser(ctx);
  const target = await getAlive(ctx, 'users', id, 'Пользователь');
  const self = actor.id === target.id;
  if (!self && !canManageUser(actor, target)) throw forbidden();
  const b = obj(input);
  const patch: Partial<User> = { ...touch(ctx) };
  if (b.lastName !== undefined) patch.lastName = str(b.lastName, 'Фамилия', { max: 60 });
  if (b.firstName !== undefined) patch.firstName = str(b.firstName, 'Имя', { max: 60 });
  if (b.middleName !== undefined) patch.middleName = str(b.middleName, 'Отчество', { max: 60, optional: true });
  if (b.email !== undefined) patch.email = str(b.email, 'Электронная почта', { max: 120, optional: true });
  if (b.login !== undefined && b.login !== target.login) {
    const lg = loginOf(b.login);
    if (await loginTaken(ctx, lg, id)) throw conflict('Такой логин уже занят');
    patch.login = lg;
  }
  if (b.role !== undefined && b.role !== target.role) {
    if (self) throw forbidden('Свою роль изменить нельзя');
    const role = oneOf(b.role, 'Роль', ROLES) as Role;
    if (!assignableRoles(actor).includes(role)) throw forbidden('Эту роль вы назначить не можете');
    patch.role = role;
  }
  if (b.status !== undefined && b.status !== target.status) {
    if (self) throw forbidden('Нельзя заблокировать самого себя');
    patch.status = oneOf(b.status, 'Состояние', ['active', 'blocked'] as const);
  }
  const updated = await ctx.repo.update('users', id, patch);
  if (patch.status === 'blocked') await dropSessions(ctx, id);
  const what = patch.role ? `роль: ${ROLE_LABEL[patch.role]}` : patch.status === 'blocked' ? 'заблокирован' : 'данные';
  await audit(ctx, 'update', 'users', id, `${fullName(updated)} — изменено (${what})`, updated.institutionId);
  return publicUser(updated);
};

export const removeUser = async (ctx: Ctx, id: string) => {
  const actor = needRole(ctx, 'owner', 'director');
  const target = await getAlive(ctx, 'users', id, 'Пользователь');
  if (!canManageUser(actor, target)) {
    throw forbidden(actor.id === target.id ? 'Нельзя удалить самого себя' : 'Этого пользователя вы удалить не можете');
  }
  await softDelete(ctx, 'users', id);
  await dropSessions(ctx, id);
  await audit(ctx, 'delete', 'users', id, `${fullName(target)} удалён в корзину`, target.institutionId);
  return { ok: true };
};

export const resetPassword = async (ctx: Ctx, id: string) => {
  const actor = needRole(ctx, 'owner', 'director');
  const target = await getAlive(ctx, 'users', id, 'Пользователь');
  if (!canManageUser(actor, target)) throw forbidden();
  const pass = tempPassword();
  await ctx.repo.update('users', id, {
    passwordHash: await ctx.hasher.hash(pass),
    mustChangePassword: true,
    failedLogins: 0,
    lockedUntil: null,
    ...touch(ctx),
  });
  await dropSessions(ctx, id);
  await audit(ctx, 'update', 'users', id, `${fullName(target)} — сброшен пароль`, target.institutionId);
  return { tempPassword: pass };
};

/* ---------- отделения ---------- */
export const listDepartments = async (ctx: Ctx, query: Query = {}) => {
  const u = needUser(ctx);
  const rows = alive(await ctx.repo.all('departments'));
  if (u.role === 'owner') return query.institutionId ? rows.filter((d) => d.institutionId === query.institutionId) : rows;
  return rows.filter((d) => d.institutionId === u.institutionId);
};

export const createDepartment = async (ctx: Ctx, input: unknown) => {
  const actor = needRole(ctx, 'owner', 'director');
  const b = obj(input);
  const row = { ...base(ctx), institutionId: instOf(actor, b.institutionId), name: str(b.name, 'Наименование', { max: 120 }) };
  await ctx.repo.insert('departments', row);
  await audit(ctx, 'create', 'departments', row.id, `Отделение «${row.name}»`, row.institutionId);
  return row;
};

export const updateDepartment = async (ctx: Ctx, id: string, input: unknown) => {
  const actor = needRole(ctx, 'owner', 'director');
  const cur = await getAlive(ctx, 'departments', id, 'Отделение');
  if (actor.role !== 'owner' && cur.institutionId !== actor.institutionId) throw forbidden();
  const row = await ctx.repo.update('departments', id, { name: str(obj(input).name, 'Наименование', { max: 120 }), ...touch(ctx) });
  await audit(ctx, 'update', 'departments', id, `Отделение «${row.name}»`, row.institutionId);
  return row;
};

export const removeDepartment = async (ctx: Ctx, id: string) => {
  const actor = needRole(ctx, 'owner', 'director');
  const cur = await getAlive(ctx, 'departments', id, 'Отделение');
  if (actor.role !== 'owner' && cur.institutionId !== actor.institutionId) throw forbidden();
  await softDelete(ctx, 'departments', id);
  await audit(ctx, 'delete', 'departments', id, `Отделение «${cur.name}» удалено в корзину`, cur.institutionId);
  return { ok: true };
};

/* ---------- учебные группы ---------- */
const canManageGroup = (u: User, g: Group) =>
  u.role === 'owner' || (u.role === 'director' && u.institutionId === g.institutionId) || g.curatorId === u.id;

const groupView = async (ctx: Ctx, g: Group) => {
  const members = alive(await ctx.repo.find('groupMembers', { groupId: g.id }));
  const curator = g.curatorId ? await ctx.repo.get('users', g.curatorId) : undefined;
  const department = g.departmentId ? await ctx.repo.get('departments', g.departmentId) : undefined;
  return {
    ...g,
    studentCount: members.length,
    curatorName: curator && !curator.deletedAt ? fullName(curator) : '',
    departmentName: department && !department.deletedAt ? department.name : '',
  };
};

export const listGroups = async (ctx: Ctx, query: Query = {}) => {
  const u = needUser(ctx);
  let rows = alive(await ctx.repo.all('groups'));
  if (u.role === 'owner') {
    if (query.institutionId) rows = rows.filter((g) => g.institutionId === query.institutionId);
  } else if (u.role === 'student') {
    const mine = new Set(alive(await ctx.repo.find('groupMembers', { studentId: u.id })).map((m) => m.groupId));
    rows = rows.filter((g) => mine.has(g.id));
  } else {
    rows = rows.filter((g) => g.institutionId === u.institutionId);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return Promise.all(rows.map((g) => groupView(ctx, g)));
};

export const getGroup = async (ctx: Ctx, id: string) => {
  const u = needUser(ctx);
  const g = await getAlive(ctx, 'groups', id, 'Группа');
  if (u.role !== 'owner' && g.institutionId !== u.institutionId) throw forbidden();
  const members = alive(await ctx.repo.find('groupMembers', { groupId: id }));
  const students = [];
  for (const m of members) {
    const s = await ctx.repo.get('users', m.studentId);
    if (s && !s.deletedAt) students.push(publicUser(s));
  }
  students.sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'));
  const view = await groupView(ctx, g);
  /* код приглашения видят только те, кто управляет группой */
  return { ...view, joinCode: canManageGroup(u, g) ? g.joinCode : '', canManage: canManageGroup(u, g), students };
};

const groupFields = async (ctx: Ctx, b: Record<string, unknown>, institutionId: string, cur?: Group) => {
  const departmentId = b.departmentId !== undefined ? optId(b.departmentId) : (cur?.departmentId ?? null);
  if (departmentId) {
    const d = await getAlive(ctx, 'departments', departmentId, 'Отделение');
    if (d.institutionId !== institutionId) throw bad('Отделение из другого учреждения');
  }
  const curatorId = b.curatorId !== undefined ? optId(b.curatorId) : (cur?.curatorId ?? null);
  if (curatorId) {
    const c = await getAlive(ctx, 'users', curatorId, 'Куратор');
    if (c.institutionId !== institutionId || !isStaff(c)) throw bad('Куратором может быть только сотрудник учреждения');
  }
  return {
    name: b.name !== undefined ? str(b.name, 'Номер группы', { max: 40 }) : (cur?.name ?? ''),
    year: b.year !== undefined ? int(b.year, 'Курс', 1, 6) : (cur?.year ?? 1),
    specialty: b.specialty !== undefined ? str(b.specialty, 'Специальность', { max: 200, optional: true }) : (cur?.specialty ?? ''),
    departmentId,
    curatorId,
  };
};

export const createGroup = async (ctx: Ctx, input: unknown) => {
  const actor = needRole(ctx, 'owner', 'director');
  const b = obj(input);
  const institutionId = instOf(actor, b.institutionId);
  const fields = await groupFields(ctx, b, institutionId);
  if (!fields.name) throw bad('Заполните поле «Номер группы»');
  const row: Group = { ...base(ctx), institutionId, ...fields, joinCode: joinCode() };
  await ctx.repo.insert('groups', row);
  await audit(ctx, 'create', 'groups', row.id, `Группа ${row.name}`, institutionId);
  return groupView(ctx, row);
};

export const updateGroup = async (ctx: Ctx, id: string, input: unknown) => {
  const actor = needRole(ctx, 'owner', 'director');
  const cur = await getAlive(ctx, 'groups', id, 'Группа');
  if (!canManageGroup(actor, cur)) throw forbidden();
  const row = await ctx.repo.update('groups', id, { ...(await groupFields(ctx, obj(input), cur.institutionId, cur)), ...touch(ctx) });
  await audit(ctx, 'update', 'groups', id, `Группа ${row.name}`, row.institutionId);
  return groupView(ctx, row);
};

export const removeGroup = async (ctx: Ctx, id: string) => {
  const actor = needRole(ctx, 'owner', 'director');
  const cur = await getAlive(ctx, 'groups', id, 'Группа');
  if (!canManageGroup(actor, cur)) throw forbidden();
  await softDelete(ctx, 'groups', id);
  await audit(ctx, 'delete', 'groups', id, `Группа ${cur.name} удалена в корзину`, cur.institutionId);
  return { ok: true };
};

export const addStudents = async (ctx: Ctx, groupId: string, input: unknown) => {
  const actor = needUser(ctx);
  const g = await getAlive(ctx, 'groups', groupId, 'Группа');
  if (!canManageGroup(actor, g)) throw forbidden();
  const ids = (obj(input).studentIds as unknown[] | undefined) ?? [];
  if (!Array.isArray(ids) || ids.length > 200) throw bad('Передайте список учащихся');
  const existing = new Set(alive(await ctx.repo.find('groupMembers', { groupId })).map((m) => m.studentId));
  let added = 0;
  await ctx.repo.tx(async () => {
    for (const raw of ids) {
      const sid = idOf(raw, 'Учащийся');
      if (existing.has(sid)) continue;
      const s = await getAlive(ctx, 'users', sid, 'Учащийся');
      if (s.role !== 'student' || s.institutionId !== g.institutionId) throw bad(`${fullName(s)} не учащийся этого учреждения`);
      await ctx.repo.insert('groupMembers', { ...base(ctx), groupId, studentId: sid });
      added++;
    }
    await audit(ctx, 'update', 'groups', groupId, `Группа ${g.name}: добавлено учащихся — ${added}`, g.institutionId);
  });
  return { added };
};

export const removeStudent = async (ctx: Ctx, groupId: string, studentId: string) => {
  const actor = needUser(ctx);
  const g = await getAlive(ctx, 'groups', groupId, 'Группа');
  if (!canManageGroup(actor, g)) throw forbidden();
  for (const m of await ctx.repo.find('groupMembers', { groupId, studentId })) await ctx.repo.remove('groupMembers', m.id);
  await audit(ctx, 'update', 'groups', groupId, `Группа ${g.name}: учащийся исключён из группы`, g.institutionId);
  return { ok: true };
};

export const regenerateCode = async (ctx: Ctx, groupId: string) => {
  const actor = needUser(ctx);
  const g = await getAlive(ctx, 'groups', groupId, 'Группа');
  if (!canManageGroup(actor, g)) throw forbidden();
  const row = await ctx.repo.update('groups', groupId, { joinCode: joinCode(), ...touch(ctx) });
  await audit(ctx, 'update', 'groups', groupId, `Группа ${g.name}: новый код приглашения`, g.institutionId);
  return { joinCode: row.joinCode };
};

/* ---------- дисциплины ---------- */
export const listDisciplines = async (ctx: Ctx, query: Query = {}) => {
  const u = needUser(ctx);
  const rows = alive(await ctx.repo.all('disciplines'));
  if (u.role === 'owner') return query.institutionId ? rows.filter((d) => d.institutionId === query.institutionId) : rows;
  return rows.filter((d) => d.institutionId === u.institutionId);
};

export const createDiscipline = async (ctx: Ctx, input: unknown) => {
  /* дисциплины ведут владелец, директор и методист */
  const actor = needRole(ctx, 'owner', 'director', 'methodist');
  const b = obj(input);
  const row = {
    ...base(ctx),
    institutionId: instOf(actor, b.institutionId),
    name: str(b.name, 'Наименование', { max: 200 }),
    code: str(b.code, 'Сокращение', { max: 20, optional: true }),
  };
  await ctx.repo.insert('disciplines', row);
  await audit(ctx, 'create', 'disciplines', row.id, `Дисциплина «${row.name}»`, row.institutionId);
  return row;
};

export const updateDiscipline = async (ctx: Ctx, id: string, input: unknown) => {
  const actor = needRole(ctx, 'owner', 'director');
  const cur = await getAlive(ctx, 'disciplines', id, 'Дисциплина');
  if (actor.role !== 'owner' && cur.institutionId !== actor.institutionId) throw forbidden();
  const b = obj(input);
  const row = await ctx.repo.update('disciplines', id, {
    name: b.name !== undefined ? str(b.name, 'Наименование', { max: 200 }) : cur.name,
    code: b.code !== undefined ? str(b.code, 'Сокращение', { max: 20, optional: true }) : cur.code,
    ...touch(ctx),
  });
  await audit(ctx, 'update', 'disciplines', id, `Дисциплина «${row.name}»`, row.institutionId);
  return row;
};

export const removeDiscipline = async (ctx: Ctx, id: string) => {
  const actor = needRole(ctx, 'owner', 'director');
  const cur = await getAlive(ctx, 'disciplines', id, 'Дисциплина');
  if (actor.role !== 'owner' && cur.institutionId !== actor.institutionId) throw forbidden();
  await softDelete(ctx, 'disciplines', id);
  await audit(ctx, 'delete', 'disciplines', id, `Дисциплина «${cur.name}» удалена в корзину`, cur.institutionId);
  return { ok: true };
};
