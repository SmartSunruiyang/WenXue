FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV LOG_EVENT_CONTEXT=false
ENV LOG_HEADER_BODY=false

COPY apps/llm-gateway/package.json ./package.json
RUN npm install --omit=dev

WORKDIR /app/apps/llm-gateway
COPY apps/llm-gateway/cloudbase-functions.json ./cloudbase-functions.json
COPY apps/llm-gateway/src ./src
COPY apps/admin-api/src /app/apps/admin-api/src
COPY apps/admin/dist /app/apps/admin/dist

EXPOSE 3000
CMD ["node", "/app/node_modules/@cloudbase/functions-framework/bin/tcb-ff.js", "--functionsConfigFile=cloudbase-functions.json", "--port=3000", "--logEventContext=false", "--logHeaderBody=false", "--noExit=true"]
