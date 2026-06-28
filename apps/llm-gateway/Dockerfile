FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV LOG_EVENT_CONTEXT=false
ENV LOG_HEADER_BODY=false

COPY package.json ./
RUN npm install --omit=dev

COPY cloudbase-functions.json ./cloudbase-functions.json
COPY src ./src

EXPOSE 3000
CMD ["node", "node_modules/@cloudbase/functions-framework/bin/tcb-ff.js", "--functionsConfigFile=cloudbase-functions.json", "--port=3000", "--logEventContext=false", "--logHeaderBody=false", "--noExit=true"]
