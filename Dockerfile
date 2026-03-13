FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY index.js .

EXPOSE 3000

CMD ["bun", "run", "start"]
