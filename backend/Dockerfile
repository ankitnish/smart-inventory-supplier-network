FROM node:22-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 4000
# Dev setup: `db push` creates tables from schema.prisma. Switch to `migrate deploy` once migrations are committed.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/server.js"]
