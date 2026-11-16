/* форматирование и подписи */
import type { CourseStatus, SubmissionStatus } from '@pc/core';

export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export const fmtDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

export const toInputDate = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');

export const plural = (n: number, forms: [string, string, string]) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
};

export const fileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} Б` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

export const COURSE_STATUS: Record<CourseStatus, { label: string; tone: 'muted' | 'warn' | 'ok' | 'info' }> = {
  draft: { label: 'Черновик', tone: 'muted' },
  review: { label: 'На проверке', tone: 'warn' },
  published: { label: 'Опубликован', tone: 'ok' },
  archived: { label: 'В архиве', tone: 'info' },
};

export const SUB_STATUS: Record<SubmissionStatus, { label: string; tone: 'muted' | 'warn' | 'ok' | 'err' | 'info' }> = {
  submitted: { label: 'На проверке', tone: 'warn' },
  returned: { label: 'На доработке', tone: 'err' },
  graded: { label: 'Оценено', tone: 'ok' },
};

export const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

export const dueText = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = daysLeft(iso);
  if (d < 0) return `срок прошёл ${fmtDate(iso)}`;
  if (d === 0) return 'срок сегодня';
  return `до ${fmtDate(iso)} (${d} ${plural(d, ['день', 'дня', 'дней'])})`;
};

export const downloadText = (name: string, text: string, type = 'text/plain;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

/* блоки модуля */
export type ItemKind = 'lecture' | 'test' | 'lab';
export const KIND_LABEL: Record<ItemKind, string> = { lecture: 'Лекция', test: 'Тест', lab: 'Лабораторная работа' };
export const KIND_ICON: Record<ItemKind, string> = { lecture: 'lecture', test: 'test', lab: 'lab' };
export const itemLink = (kind: ItemKind, id: string) => `/learn/${kind}/${id}`;

/* срок: текст и тон метки */
export const dueInfo = (iso: string | null | undefined): { text: string; tone: 'err' | 'warn' | 'muted' } | null => {
  if (!iso) return null;
  const d = daysLeft(iso);
  if (d < 0) return { text: `просрочено на ${-d} ${plural(-d, ['день', 'дня', 'дней'])}`, tone: 'err' };
  if (d === 0) return { text: 'сдать сегодня', tone: 'warn' };
  if (d <= 3) return { text: `осталось ${d} ${plural(d, ['день', 'дня', 'дней'])}`, tone: 'warn' };
  return { text: `до ${fmtDate(iso)}`, tone: 'muted' };
};

/* код группы для показа: K7MQ-4XP2 */
export const fmtCode = (c: string) => (c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);
