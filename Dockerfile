FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
COPY test/scenarios.js ./test/scenarios.js
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
