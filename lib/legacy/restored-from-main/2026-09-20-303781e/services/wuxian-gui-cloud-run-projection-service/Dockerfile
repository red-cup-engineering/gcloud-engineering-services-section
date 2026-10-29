FROM us-central1-docker.pkg.dev/five-six-one-group-dev/cloud-run-source-deploy/wuxian-gui@sha256:28637d3bd4f83f87af4f5bb63965b9f6cd6b91162a3ec86f65f796b23993f38e
COPY src/server.mjs /app/server.mjs
COPY scripts/transplant-successor-coordinate.mjs /tmp/transplant-successor-coordinate.mjs
RUN node /tmp/transplant-successor-coordinate.mjs /app/worker.mjs && rm /tmp/transplant-successor-coordinate.mjs
