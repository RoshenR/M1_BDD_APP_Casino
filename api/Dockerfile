# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json ./
RUN npm install

# --- developpement : rechargement a chaud via tsx watch ---------------------
FROM base AS dev
COPY tsconfig.json ./
COPY src ./src
EXPOSE 3000
CMD ["npm", "run", "dev"]

# --- production : compile en JS --------------------------------------------
FROM base AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
