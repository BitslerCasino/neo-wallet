FROM node:12-slim

WORKDIR /usr/src/app 
COPY yarn.lock ./
RUN npm install pm2 -g && yarn install --prod
COPY . .
RUN chmod +x /usr/src/app/bin/neo-cli && ln -s /usr/src/app/bin/neo-cli /usr/bin/

EXPOSE 10333

CMD [ "pm2-runtime", "ecosystem.config.js" ]