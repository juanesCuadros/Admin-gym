# ==========================================
# Etapa 1: compilar el sitio público
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Variables de compilación (Vite las incrusta en el bundle)
ARG VITE_API_URL=/api/v1
ARG VITE_DOMINIO_BASE=gymdeskcolombia.com
ARG VITE_CONTACTO_WHATSAPP=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_DOMINIO_BASE=$VITE_DOMINIO_BASE
ENV VITE_CONTACTO_WHATSAPP=$VITE_CONTACTO_WHATSAPP

RUN npm run build

# ==========================================
# Etapa 2: servir con nginx
# ==========================================
FROM nginx:1.27-alpine AS production

RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
