/* проверка входных данных: одна и та же в браузере и на сервере */
import { bad } from './errors.ts';

type In = Record<string, unknown>;

export const obj = (v: unknown, field = 'Данные'): In => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${field}: ожидается объект`);
  return v as In;
};

export const str = (
  v: unknown,
  field: string,
  { min = 1, max = 200, optional = false }: { min?: number; max?: number; optional?: boolean } = {},
): string => {
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    throw bad(`Заполните поле «${field}»`);
  }
  if (typeof v !== 'string') throw bad(`Поле «${field}» должно быть строкой`);
  const s = v.trim();
  if (s.length < min && !(optional && s.length === 0)) throw bad(`Поле «${field}»: не короче ${min} символов`);
  if (s.length > max) throw bad(`Поле «${field}»: не длиннее ${max} символов`);
  return s;
};

export const int = (v: unknown, field: string, min: number, max: number): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw bad(`Поле «${field}» должно быть целым числом`);
  if (n < min || n > max) throw bad(`Поле «${field}»: от ${min} до ${max}`);
  return n;
};

export const bool = (v: unknown, def = false): boolean => (typeof v === 'boolean' ? v : def);

export const oneOf = <T extends string>(v: unknown, field: string, values: readonly T[]): T => {
  if (typeof v !== 'string' || !values.includes(v as T)) throw bad(`Недопустимое значение поля «${field}»`);
  return v as T;
};

export const arr = <T>(v: unknown, field: string, map: (x: unknown, i: number) => T, max = 500): T[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`Поле «${field}» должно быть списком`);
  if (v.length > max) throw bad(`Поле «${field}»: не больше ${max} элементов`);
  return v.map(map);
};

export const idOf = (v: unknown, field: string): string => str(v, field, { max: 64 });

export const optId = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/* логин: латиница, цифры, точка, дефис, подчёркивание */
export const login = (v: unknown): string => {
  const s = str(v, 'Логин', { min: 3, max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(s)) throw bad('Логин: только латинские буквы, цифры, точка, дефис и подчёркивание');
  return s;
};

export const password = (v: unknown): string => {
  const s = typeof v === 'string' ? v : '';
  if (s.length < 8) throw bad('Пароль должен быть не короче 8 символов');
  if (s.length > 128) throw bad('Пароль слишком длинный');
  if (!/[a-zA-Zа-яА-Я]/.test(s) || !/\d/.test(s)) throw bad('Пароль должен содержать буквы и цифры');
  return s;
};

/* нормализация ответа: регистр, «ё», знаки препинания и лишние пробелы не важны */
export const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`„“”()[\]{}.,;:!?…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
