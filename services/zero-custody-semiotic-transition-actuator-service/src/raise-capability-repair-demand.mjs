import { induceCapabilityRepairDemand } from "@red-cup-engineering/ethereum-services-section/semiotic-exchange-demand-induction";

const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;

/**
 * The earned `raiseDemand` articulation: form canonical capability-repair
 * bytes and consume one already-admitted zero-custody SemioticExchange
 * transition.  A chain refusal remains an obstruction, never a receipt.
 */
export async function raiseCapabilityRepairDemand({ raiser, locus, operation, objective, refusalCode, refusalWitnessNis, requiredStandard, inputNi, transition }) {
  const induced = induceCapabilityRepairDemand({ raiser, locus, operation, objective, refusalCode, refusalWitnessNis, requiredStandard, inputNi });
  if (typeof transition !== "function") return Object.freeze({ disposition: "chain-transition-unavailable", demandNi: induced.demandNi, obstruction: "no admitted zero-custody SemioticExchange transition was supplied" });
  try {
    const settled = await transition(Object.freeze({
      rmnSemanticDigest: induced.demandBytes32,
      transition: Object.freeze({ operation: "raiseDemand", args: induced.raiseDemand.args }),
      demand: induced,
    }));
    const transactionHash = settled?.transactionHash ?? settled?.object?.data?.receipt?.transactionHash;
    const eventReceipt = settled?.eventReceipt ?? settled?.object?.data?.eventReceipt;
    if (!/^0x[0-9a-fA-F]{64}$/u.test(transactionHash ?? "") || eventReceipt?.type !== "SemioticExchangeEventReceipt" || eventReceipt.move !== "DemandRaised" || eventReceipt.demand?.toLowerCase() !== induced.demandBytes32.toLowerCase()) throw new Error("zero-custody transition returned no canonical DemandRaised event receipt");
    return Object.freeze({ disposition: "demand-raised", demandNi: induced.demandNi, transactionHash: transactionHash.toLowerCase(), eventReceipt });
  } catch (error) {
    return Object.freeze({ disposition: "chain-transition-refused", demandNi: induced.demandNi, obstruction: error instanceof Error ? error.message : String(error) });
  }
}
