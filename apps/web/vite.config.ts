import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* сжатые копии файлов (.br и .gz): сервер отдаёт их браузеру вместо исходных */
const precompress = (): Plugin => {
  let dir = '';
  return {
    name: 'precompress',
    apply: 'build',
    configResolved(config) {
      dir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const walk = (d: string) => {
        for (const name of readdirSync(d)) {
          const p = join(d, name);
          if (statSync(p).isDirectory()) walk(p);
          else if (/\.(js|css|html|svg|json|webmanifest)$/.test(name) && statSync(p).size > 1024) {
            const data = readFileSync(p);
            writeFileSync(
              `${p}.br`,
              brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
            );
            writeFileSync(`${p}.gz`, gzipSync(data, { level: 9 }));
          }
        }
      };
      walk(dir);
    },
  };
};

/* обычная сборка — сайт (сервер или GitHub Pages); offline — один html-файл для запуска с диска */
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'offline' ? [viteSingleFile()] : [precompress()])],
  build: {
    outDir: mode === 'offline' ? 'dist-offline' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
}));
