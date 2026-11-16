/* настройки Drizzle Kit: схема → SQL-миграции в папке drizzle */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
});
