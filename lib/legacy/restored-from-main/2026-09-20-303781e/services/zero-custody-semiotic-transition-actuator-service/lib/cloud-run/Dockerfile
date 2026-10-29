FROM node:24-slim
WORKDIR /app
COPY artifact/enterprise-user-operation.mjs runtime/enterprise-user-operation.mjs
COPY artifact/run-direct-leader-transition.mjs scripts/run-direct-leader-transition.mjs
RUN npm init -y && npm install --omit=dev ethers@6.17.0 viem@2.55.4
CMD ["node", "scripts/run-direct-leader-transition.mjs"]
