#!/usr/bin/env node
import { createServer } from "node:http";
import { ACTOR_ID, actuate, agentCard } from "../src/gcloud-cloud-run-actuator.mjs";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const base = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
const bearer = process.env.ACTUATOR_BEARER_TOKEN;
function send(response, status, value, type = "application/json") { response.writeHead(status, { "content-type": type }); response.end(typeof value === "string" ? value : JSON.stringify(value)); }
function authorized(request) { return Boolean(bearer) && request.headers.authorization === `Bearer ${bearer}`; }
async function body(request) { const chunks = []; for await (const part of request) chunks.push(part); return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
createServer(async (request, response) => {
  const path = new URL(request.url, base).pathname;
  if (request.method === "GET" && path === "/.well-known/agent-card.json") return send(response, 200, agentCard(base));
  if (request.method === "GET" && path === "/actor") return send(response, 200, { "@context": "https://www.w3.org/ns/activitystreams", id: `${base}/actor`, type: "Service", preferredUsername: "gcloud-cloud-run-actuator", inbox: `${base}/inbox`, outbox: `${base}/outbox`, url: `${base}/.well-known/agent-card.json`, "union:actor": ACTOR_ID });
  if (request.method === "GET" && path === "/outbox") return send(response, 200, { "@context": "https://www.w3.org/ns/activitystreams", id: `${base}/outbox`, type: "OrderedCollection", totalItems: 0, orderedItems: [] });
  if (request.method === "POST" && path === "/inbox") return send(response, 202, { accepted: true, actor: ACTOR_ID });
  if (request.method !== "POST" || path !== "/a2a") return send(response, 404, { error: "not found" });
  try {
    const rpc = await body(request); const input = rpc?.params?.input ?? rpc?.params;
    if (!input || typeof input !== "object") throw new Error("A2A request requires params.input");
    if (input.operation !== "discover-cloud-run-service" && !authorized(request)) return send(response, 401, { jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32001, message: "mutating actuator operation requires ACTUATOR_BEARER_TOKEN" } });
    const result = await actuate(input);
    return send(response, 200, { jsonrpc: "2.0", id: rpc.id ?? null, result: { id: result.receipt.id, status: { state: "completed" }, artifacts: [{ parts: [{ kind: "text", text: result.jsonl }] }] } });
  } catch (error) { return send(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32000, message: error.message } }); }
}).listen(port, host, () => process.stderr.write(`GCloud Cloud Run Actuator ${ACTOR_ID} listening on ${host}:${port}\n`));
