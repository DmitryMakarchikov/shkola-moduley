# сборка и запуск платформы «Школа модулей» на сервере
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000
VOLUME ["/app/apps/server/data", "/app/apps/server/storage"]
CMD ["node", "apps/server/src/main.ts"]
