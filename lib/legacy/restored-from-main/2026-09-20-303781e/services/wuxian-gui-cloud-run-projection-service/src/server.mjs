import { createServer } from "node:http";
import worker from "/app/worker.mjs";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const operatorEmail = process.env.IAP_OPERATOR_EMAIL ?? "";
const publicProjection = process.env.MUD_PUBLIC_PROJECTION ?? "";
const chainReaderOrigin = new URL(process.env.MUD_CHAIN_READER_ORIGIN ?? "http://10.128.0.2:8562");
const mudDemandActorOrigin = new URL(process.env.MUD_DEMAND_ACTOR_ORIGIN ?? "http://mud-demand-actor.internal");

if (chainReaderOrigin.protocol !== "http:" || chainReaderOrigin.hostname !== "10.128.0.2" || chainReaderOrigin.port !== "8562") {
  throw new Error("MUD_CHAIN_READER_ORIGIN must name the bounded private history membrane");
}
if (mudDemandActorOrigin.protocol !== "http:" || !mudDemandActorOrigin.hostname.endsWith(".internal")) {
  throw new Error("MUD_DEMAND_ACTOR_ORIGIN must name the private MUD ActivityPub actor");
}

const environment = Object.freeze({
  IAP_OPERATOR_EMAIL: operatorEmail,
  MUD_PUBLIC_PROJECTION: publicProjection,
  MUD_CHAIN_READER: Object.freeze({
    async fetch(_input, init) {
      const response = await fetch(new URL("/v1/semiotic-exchange/rpc", chainReaderOrigin), init);
      if (!response.ok) console.error("chain reader refusal", response.status, await response.clone().text());
      return response;
    },
  }),
  MUD_DEMAND_ACTOR: Object.freeze({
    async fetch(_input, init) {
      const response = await fetch(new URL("/v1/mud/demands", mudDemandActorOrigin), init);
      if (!response.ok) console.error("MUD demand actor refusal", response.status, await response.clone().text());
      return response;
    },
  }),
});

createServer(async (incoming, outgoing) => {
  try {
    const body = incoming.method === "GET" || incoming.method === "HEAD" ? undefined : incoming;
    const request = new Request(new URL(incoming.url ?? "/", "https://gui.561.group"), {
      method: incoming.method,
      headers: incoming.headers,
      body,
      ...(body === undefined ? {} : { duplex: "half" }),
    });
    const response = await worker.fetch(request, environment);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    outgoing.end("Internal Server Error\n");
  }
}).listen(port, "0.0.0.0", async () => {
  console.log(`Wuxian GUI listening on 0.0.0.0:${port}`);
  try {
    const warmup = await worker.fetch(new Request("https://gui.561.group/api/mud", {
      headers: { "x-goog-authenticated-user-email": `accounts.google.com:${operatorEmail}` },
    }), environment);
    if (!warmup.ok) console.error("private dimension warmup refused", warmup.status, await warmup.text());
  } catch (error) {
    console.error("private dimension warmup unavailable", error);
  }
});
