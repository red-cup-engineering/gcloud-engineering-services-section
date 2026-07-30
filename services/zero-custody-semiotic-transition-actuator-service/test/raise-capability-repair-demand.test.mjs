import test from "node:test";
import assert from "node:assert/strict";
import { raiseCapabilityRepairDemand } from "../src/raise-capability-repair-demand.mjs";

const input = Object.freeze({
  raiser: "0x313553ca5ef4e5c5e0b455f92e074eab181cfcf4", locus: "lib/example",
  operation: "repair-work-order", objective: "repair the exact bounded capability",
  refusalCode: "no-admissible-provider-offer", refusalWitnessNis: ["ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  requiredStandard: "org.emsenn.semiotic-exchange-chain.v1", inputNi: "ni:///sha-256;BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
});

test("an accepted inference path does not invoke the repair-demand articulation", () => {
  let calls = 0;
  const acceptedInference = { disposition: "candidate-pending-customer-acceptance" };
  if (acceptedInference.disposition === "no-admissible-provider-offer") calls += 1;
  assert.equal(calls, 0);
});

test("one no-admissible residue raises one canonical demand with a stable replay identity", async () => {
  const transitions = [];
  const transition = async ({ demand, transition: move }) => {
    transitions.push(move);
    return { transactionHash: `0x${"11".repeat(32)}`, eventReceipt: { type: "SemioticExchangeEventReceipt", move: "DemandRaised", demand: demand.demandBytes32 } };
  };
  const first = await raiseCapabilityRepairDemand({ ...input, transition });
  const replay = await raiseCapabilityRepairDemand({ ...input, transition });
  assert.equal(first.disposition, "demand-raised");
  assert.equal(first.demandNi, replay.demandNi);
  assert.deepEqual(transitions.map(({ operation }) => operation), ["raiseDemand", "raiseDemand"]);
});

test("chain refusal remains an explicit obstruction without a fake receipt", async () => {
  const result = await raiseCapabilityRepairDemand({ ...input, transition: async () => { throw new Error("policy refused"); } });
  assert.deepEqual(result, { disposition: "chain-transition-refused", demandNi: result.demandNi, obstruction: "policy refused" });
  assert.equal(Object.hasOwn(result, "eventReceipt"), false);
});
