FROM node:alpine
COPY . /app
WORKDIR /app
VOLUME /docs
CMD ["node", "server.js"]
EXPOSE 80
