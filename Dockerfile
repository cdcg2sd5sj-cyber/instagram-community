FROM node:20-alpine

WORKDIR /app

COPY backend/package.json ./
RUN npm install

COPY backend/ ./
COPY prisma/ ./prisma/

RUN npx prisma generate
RUN ./node_modules/.bin/nest build
RUN ls -la dist/

EXPOSE 3000

CMD ["node", "dist/main.js"]
