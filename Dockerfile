# Surety — production image.
# Node's built-in sqlite means no native builds; the web console is
# compiled ahead of time and served statically by the API server.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install
COPY web ./web
RUN cd web && npm run build
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
EXPOSE 10000
CMD ["node", "dist/server.js"]
