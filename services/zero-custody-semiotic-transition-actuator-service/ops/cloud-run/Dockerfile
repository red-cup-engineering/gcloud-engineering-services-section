FROM node:24-slim
WORKDIR /app
COPY . /app
RUN npm install --omit=dev
CMD ["node","bin/run-direct-leader-transition.mjs"]
