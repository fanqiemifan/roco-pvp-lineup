FROM nikolaik/python-nodejs:python3.11-nodejs20 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

FROM nikolaik/python-nodejs:python3.11-nodejs20 AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist-electron ./dist-electron
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/resources ./resources
COPY --from=build /app/shared ./shared

RUN mkdir -p /app/LuokePVPWebui/runtime /app/LuokePVPWebui/cache

EXPOSE 9989

CMD ["node", "dist-electron/electron/server-entry.js", "--host", "0.0.0.0", "--port", "9989"]
