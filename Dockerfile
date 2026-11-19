# syntax=docker/dockerfile:1

# --- Сборка TypeScript ---
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && find dist -name '*.test.*' -delete \
    && rm -rf dist/testing

# --- Рантайм: только скомпилированный код и статика, зависимостей нет ---
FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY public ./public
USER node
EXPOSE 3000
ENTRYPOINT ["node", "dist/bin.js"]
# Консольный режим по умолчанию показывает справку.
# Серверный режим: docker run -p 3000:3000 <образ> serve --host 0.0.0.0
CMD ["--help"]
