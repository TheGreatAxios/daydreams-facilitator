import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";

import { facilitator } from "./facilitatorCore.js";

export const localFacilitatorClient = {
  verify: (paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) =>
    facilitator.verify(paymentPayload, paymentRequirements) as Promise<VerifyResponse>,
  settle: (paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) =>
    facilitator.settle(paymentPayload, paymentRequirements) as Promise<SettleResponse>,
  getSupported: async () =>
    facilitator.getSupported() as SupportedResponse,
};

