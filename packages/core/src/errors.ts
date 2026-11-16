/* ошибки с HTTP-статусом: одинаково понятны серверу и автономному режиму */
export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (message: string) => new AppError(400, 'bad_request', message);
export const unauthorized = (message = 'Войдите в систему') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Недостаточно прав для этого действия') =>
  new AppError(403, 'forbidden', message);
export const notFound = (what = 'Объект') => new AppError(404, 'not_found', `${what} не найден`);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const tooMany = (message: string) => new AppError(429, 'too_many', message);
