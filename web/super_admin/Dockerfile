# Tableau de bord : construit avec Node, servi par nginx (déploiement Dokploy ou tout hébergeur Docker).
# L'adresse de l'API est figée à la construction (arguments de build Dokploy) ; nginx la reprend pour la règle de sécurité.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=https://api.kraveo.site
ARG VITE_SOCKET_URL=https://api.kraveo.site
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_SOCKET_URL=$VITE_SOCKET_URL
RUN npm run build

FROM nginx:1.27-alpine
# nginx remplace ${API_ORIGIN} et ${API_WS_ORIGIN} au démarrage (modèles /etc/nginx/templates).
ENV API_ORIGIN=https://api.kraveo.site API_WS_ORIGIN=wss://api.kraveo.site
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
