# syntax=docker/dockerfile:1

# This builds the server
FROM node:18-alpine AS builder

RUN mkdir /build
WORKDIR /build

COPY package.json .
COPY yarn.lock .
RUN yarn install --immutable
RUN yarn list

COPY . .
RUN yarn build

# This actually runs the server
FROM node:18-alpine

RUN apk add dumb-init

WORKDIR /app

COPY --from=builder --chown=node:node /build/package.json ./package.json
COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --from=builder --chown=node:node /build/dist ./dist
RUN rm -rf ./dist/client

USER node
EXPOSE 9001
ENV PORT 9001
ENV HOST 0.0.0.0

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "yarn start"]