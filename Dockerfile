FROM node:24.22.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund
COPY . .
RUN npm run build
FROM nginx:stable-alpine
COPY --from=build /app/static/app /usr/share/nginx/html
EXPOSE 80
