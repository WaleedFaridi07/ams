FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w api

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/data ./data
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["npm", "run", "start"]
