/* клиент API: одинаковый интерфейс для серверного и автономного режимов */
import type { FileRow, Method } from '@pc/core';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface Client {
  mode: 'local' | 'server';
  call<T = unknown>(method: Method, path: string, body?: unknown, query?: Query): Promise<T>;
  upload(file: File, scope: 'content' | 'submission'): Promise<FileRow>;
  fileUrl(id: string): Promise<string>;
  subscribe(fn: (event: { type: string; data?: unknown }) => void): () => void;
  reset?(): Promise<void>;
}

export const cleanQuery = (q: Query = {}) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  return out;
};
