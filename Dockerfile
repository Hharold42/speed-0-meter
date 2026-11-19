# syntax=docker/dockerfile:1

# --- Сборка TypeScript ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && find dist -name '*.test.*' -delete

# --- Рантайм: только скомпилированный код, зависимостей нет ---
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/bin.js"]
CMD ["--help"]
