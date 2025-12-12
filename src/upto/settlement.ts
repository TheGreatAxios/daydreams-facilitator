import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import type { UptoSessionStore } from "./sessionStore.js";

export type UptoFacilitatorClient = {
  settle: (
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements
  ) => Promise<SettleResponse>;
};

export async function settleUptoSession(
  store: UptoSessionStore,
  facilitatorClient: UptoFacilitatorClient,
  sessionId: string,
  reason: string,
  closeAfter = false,
  deadlineBufferSec = 60
) {
  const session = store.get(sessionId);
  if (!session) return;
  if (session.status !== "open") return;

  if (session.pendingSpent <= 0n) {
    if (closeAfter) {
      session.status = "closed";
      store.set(sessionId, session);
    }
    return;
  }

  session.status = "settling";
  store.set(sessionId, session);

  const settleAmount = session.pendingSpent;
  const settleRequirements: PaymentRequirements = {
    ...session.paymentRequirements,
    amount: settleAmount.toString(),
  };

  let receipt: SettleResponse;
  try {
    receipt = await facilitatorClient.settle(
      session.paymentPayload,
      settleRequirements
    );
  } catch (error) {
    receipt = {
      success: false,
      errorReason: error instanceof Error ? error.message : "settlement_failed",
      transaction: "",
      network: session.paymentPayload.accepted.network,
      payer: undefined,
    };
  }

  if (receipt.success) {
    session.settledTotal += settleAmount;
    session.pendingSpent = 0n;
  }

  session.lastSettlement = {
    atMs: Date.now(),
    reason,
    receipt,
  };

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (
    closeAfter ||
    session.settledTotal >= session.cap ||
    session.deadline <= nowSec + BigInt(deadlineBufferSec)
  ) {
    session.status = "closed";
  } else {
    session.status = "open";
  }

  store.set(sessionId, session);
}

