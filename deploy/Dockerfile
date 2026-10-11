FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY app/package.json ./app/package.json
RUN cd app && npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production LEXUS_WEB_HOST=0.0.0.0 LEXUS_WEB_PORT=8081 LEXUS_LICENSE_DATA=/data/license-data LEXUS_WEB_DATA=/data/web-data
USER node
EXPOSE 8081
CMD ["node", "server.cjs"]
