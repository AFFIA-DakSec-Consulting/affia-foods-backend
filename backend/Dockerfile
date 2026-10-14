# Build : compile TypeScript et génère le client Prisma
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime : dépendances de prod + dist + schéma Prisma (pour migrate deploy)
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=5000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY public ./public
COPY package.json ./
COPY docker/entrypoint.sh ./docker/entrypoint.sh
# La CLI prisma est une devDependency : on l'installe à part pour pouvoir lancer les migrations au démarrage
RUN npm install --no-save prisma@5.22.0 && mkdir -p /app/public/uploads/vendors && chown -R node:node /app
USER node
EXPOSE 5000
CMD ["sh", "docker/entrypoint.sh"]
