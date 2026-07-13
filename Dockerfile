FROM node:20-alpine AS builder

WORKDIR /app

# Install root dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Install server dependencies and build
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY server/ server/
RUN cd server && npm run build

# Install client dependencies and build
COPY client/package.json client/package-lock.json client/
RUN cd client && npm ci
COPY client/ client/
RUN cd client && npm run build

FROM node:20-alpine
WORKDIR /app

# Copy built server
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/package.json ./server/

# Copy built client
COPY --from=builder /app/client/dist ./client/dist

# Copy server source for database init
COPY --from=builder /app/server/src ./server/src

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
