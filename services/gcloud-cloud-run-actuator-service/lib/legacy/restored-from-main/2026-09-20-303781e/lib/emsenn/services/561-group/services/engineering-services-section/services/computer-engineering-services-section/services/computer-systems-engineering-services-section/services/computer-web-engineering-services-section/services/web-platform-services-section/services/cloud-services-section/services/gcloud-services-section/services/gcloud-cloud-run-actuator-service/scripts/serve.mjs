#!/usr/bin/env node
import { createServer } from "node:http";
import { ACTOR_ID } from "../src/gcloud-cloud-run-actuator.mjs";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const base = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
function send(response, status, value, type = "application/json") { response.writeHead(status, { "content-type": type }); response.end(typeof value === "string" ? value : JSON.stringify(value)); }
createServer(async (request, response) => {
  const path = new URL(request.url, base).pathname;
  if (request.method === "GET" && path === "/actor") return send(response, 200, { "@context": "https://www.w3.org/ns/activitystreams", id: `${base}/actor`, type: "Service", preferredUsername: "gcloud-cloud-run-actuator", inbox: `${base}/inbox`, outbox: `${base}/outbox`, "union:actor": ACTOR_ID });
  if (request.method === "GET" && path === "/outbox") return send(response, 200, { "@context": "https://www.w3.org/ns/activitystreams", id: `${base}/outbox`, type: "OrderedCollection", totalItems: 0, orderedItems: [] });
  if (request.method === "POST" && path === "/inbox") return send(response, 503, { error: "ActivityPub(CloudEvent(A2A)) admission is not bound" });
  return send(response, 404, { error: "not found" });
}).listen(port, host, () => process.stderr.write(`GCloud Cloud Run Actuator ${ACTOR_ID} listening on ${host}:${port}\n`));
