FROM node:20-alpine

WORKDIR /app

COPY backend/package.json ./
RUN npm install
RUN npm install -g ts-node typescript

COPY backend/ ./
COPY prisma/ ./prisma/

RUN npx prisma generate

EXPOSE 3000

CMD ["ts-node", "--transpile-only", "src/main.ts"]
