FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# Install deps first (layer cache)
COPY backend/package.json ./backend/
RUN cd backend && npm install

# Copy source preserving directory structure (prisma/ lives next to backend/)
COPY prisma/ ./prisma/
COPY backend/ ./backend/

# Generate Prisma client into backend/node_modules/.prisma/client (matches schema output path)
RUN cd backend && ./node_modules/.bin/prisma generate --schema ../prisma/schema.prisma

# Compile TypeScript
RUN cd backend && ./node_modules/.bin/nest build

EXPOSE 3000

# Apply pending migrations then start
CMD ["sh", "-c", "cd backend && ./node_modules/.bin/prisma migrate deploy --schema ../prisma/schema.prisma && node dist/main.js"]
