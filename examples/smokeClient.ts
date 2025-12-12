import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
} from "@x402/core/types";
import { createPublicClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4022";
const CLIENT_EVM_PRIVATE_KEY = process.env.CLIENT_EVM_PRIVATE_KEY;

if (!CLIENT_EVM_PRIVATE_KEY) {
  console.error("Set CLIENT_EVM_PRIVATE_KEY to run smoke client");
  process.exit(1);
}

const account = privateKeyToAccount(CLIENT_EVM_PRIVATE_KEY as `0x${string}`);
console.log("payer", account.address);

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.RPC_URL ?? process.env.EVM_RPC_URL_BASE),
});

const noncesAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
] as const;

type PermitCacheEntry = {
  paymentPayload: PaymentPayload;
  cap: bigint;
  deadline: bigint;
};

const permitCache = new Map<string, PermitCacheEntry>();

function getCacheKey(req: PaymentRequirements) {
  const chainId = req.network.split(":")[1];
  return [
    chainId,
    getAddress(req.asset),
    getAddress(account.address),
    getAddress(req.payTo),
  ].join(":");
}

async function createUptoPaymentPayload(
  paymentRequired: PaymentRequired
): Promise<PaymentPayload> {
  const requirement = paymentRequired.accepts.find((r) => r.scheme === "upto");
  if (!requirement) {
    throw new Error("No upto requirement in accepts");
  }

  const extra = requirement.extra as Record<string, unknown> | undefined;
  const name = extra?.name as string | undefined;
  const version = extra?.version as string | undefined;
  const maxAmountRequired = BigInt(
    (extra?.maxAmountRequired as string | undefined) ?? requirement.amount
  );
  if (!name || !version) {
    throw new Error("Requirement missing ERC-2612 domain name/version");
  }

  const key = getCacheKey(requirement);
  const cached = permitCache.get(key);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (
    cached &&
    cached.deadline > nowSec + 30n &&
    cached.cap >= maxAmountRequired
  ) {
    return cached.paymentPayload;
  }

  const owner = getAddress(account.address);
  const spender = getAddress(requirement.payTo);
  const asset = getAddress(requirement.asset);
  const chainId = Number(requirement.network.split(":")[1]);

  const nonce = (await publicClient.readContract({
    address: asset,
    abi: noncesAbi,
    functionName: "nonces",
    args: [owner],
  })) as bigint;

  const deadline = BigInt(
    Math.floor(Date.now() / 1000 + requirement.maxTimeoutSeconds)
  );

  const signature = await account.signTypedData({
    domain: {
      name,
      version,
      chainId,
      verifyingContract: asset,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner,
      spender,
      value: maxAmountRequired,
      nonce,
      deadline,
    },
  });

  const paymentPayload: PaymentPayload = {
    x402Version: paymentRequired.x402Version,
    resource: paymentRequired.resource,
    extensions: paymentRequired.extensions,
    accepted: requirement,
    payload: {
      authorization: {
        from: owner,
        to: spender,
        value: maxAmountRequired.toString(),
        validBefore: deadline.toString(),
        nonce: nonce.toString(),
      },
      signature,
    },
  };

  permitCache.set(key, {
    paymentPayload,
    cap: maxAmountRequired,
    deadline,
  });

  return paymentPayload;
}

async function fetchWithUpto(
  path: string,
  paymentHeader?: string
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    // x402 v2 uses PAYMENT-SIGNATURE (v1 used X-PAYMENT).
    headers: paymentHeader ? { "PAYMENT-SIGNATURE": paymentHeader } : {},
  });
}

async function main() {
  const path = "/api/upto-premium";
  let paymentHeader: string | undefined;
  let sessionId: string | undefined;

  // Make a few requests to accrue spend.
  for (let i = 0; i < 3; i++) {
    let res = await fetchWithUpto(path, paymentHeader);
    if (res.status === 402) {
      const requiredHeader = res.headers.get("PAYMENT-REQUIRED");
      if (!requiredHeader) {
        console.error("402 without PAYMENT-REQUIRED header:", await res.text());
        process.exit(1);
      }

      const paymentRequired = decodePaymentRequiredHeader(
        requiredHeader
      ) as PaymentRequired;

      const payload = await createUptoPaymentPayload(paymentRequired);
      paymentHeader = encodePaymentSignatureHeader(payload);

      // retry this iteration with payment
      res = await fetchWithUpto(path, paymentHeader);
    }

    if (!res.ok) {
      console.error("Request failed", res.status, await res.text());
      process.exit(1);
    }

    sessionId = res.headers.get("x-upto-session-id") ?? sessionId;
    console.log("premium response", i + 1, await res.json());
  }

  if (!sessionId) {
    console.error("No session id returned; did payment succeed?");
    return;
  }

  console.log("sessionId", sessionId);

  const status1 = await fetch(`${BASE_URL}/api/upto-session/${sessionId}`).then(
    (r) => r.json()
  );
  console.log("session status (before settle)", status1);

  // Force a final batch settle now (optional; auto-sweeper would do this after idle).
  const closeRes = await fetch(`${BASE_URL}/api/upto-close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  console.log("close settle response", await closeRes.json());

  const status2 = await fetch(`${BASE_URL}/api/upto-session/${sessionId}`).then(
    (r) => r.json()
  );
  console.log("session status (after settle)", status2);

  const paymentResponseHeader = closeRes.headers.get("PAYMENT-RESPONSE");
  if (paymentResponseHeader) {
    console.log(
      "decoded PAYMENT-RESPONSE",
      decodePaymentResponseHeader(paymentResponseHeader)
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
