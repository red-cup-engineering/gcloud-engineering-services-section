FROM gcr.io/google.com/cloudsdktool/google-cloud-cli:slim
WORKDIR /app
RUN apt-get update && apt-get install --yes --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY src ./src
COPY bin ./bin
RUN chmod +x bin/*.mjs
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
CMD ["node", "bin/serve.mjs"]
