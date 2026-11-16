/* роли и права */
import type { Course, Role, User } from './model.ts';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец платформы',
  director: 'Директор',
  methodist: 'Методист',
  teacher: 'Преподаватель',
  student: 'Учащийся',
};

export const ROLES: Role[] = ['owner', 'director', 'methodist', 'teacher', 'student'];
export const STAFF: Role[] = ['owner', 'director', 'methodist', 'teacher'];

export const isStaff = (u: User) => STAFF.includes(u.role);
export const isAdmin = (u: User) => u.role === 'owner' || u.role === 'director';

export const sameInst = (u: User, institutionId: string | null) =>
  u.role === 'owner' || (!!u.institutionId && u.institutionId === institutionId);

/* какие роли может выдавать пользователь */
export const assignableRoles = (actor: User): Role[] => {
  if (actor.role === 'owner') return ['director', 'methodist', 'teacher', 'student'];
  if (actor.role === 'director') return ['methodist', 'teacher', 'student'];
  return [];
};

/* директор управляет методистами, преподавателями и учащимися своего учреждения;
   владельца, других директоров и себя он удалить не может */
export const canManageUser = (actor: User, target: Pick<User, 'id' | 'role' | 'institutionId'>) => {
  if (actor.id === target.id) return false;
  if (actor.role === 'owner') return target.role !== 'owner';
  if (actor.role === 'director') {
    return target.institutionId === actor.institutionId && assignableRoles(actor).includes(target.role);
  }
  return false;
};

export const canEditCourse = (u: User, c: Course) => {
  if (u.role === 'owner') return true;
  if (!sameInst(u, c.institutionId)) return false;
  if (u.role === 'director') return true;
  return u.role === 'teacher' && c.authorId === u.id && c.status !== 'archived';
};

export const canReviewCourse = (u: User, c: Course) =>
  u.role === 'owner' || ((u.role === 'director' || u.role === 'methodist') && sameInst(u, c.institutionId));

export const canViewCourseAsStaff = (u: User, c: Course) => {
  if (u.role === 'owner') return true;
  if (!sameInst(u, c.institutionId)) return false;
  if (u.role === 'director' || u.role === 'methodist') return true;
  return u.role === 'teacher' && (c.authorId === u.id || c.status === 'published');
};
