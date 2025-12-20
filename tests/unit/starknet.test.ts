import { describe, it, expect } from "bun:test";
import { x402Facilitator } from "@x402/core/facilitator";

import {
  getStarknetNetwork,
  getStarknetNetworkCaip,
  resolveStarknetRpcUrl,
  validateStarknetNetworks,
} from "../../src/networks.js";
import { ExactStarknetScheme } from "../../src/starknet/exact/facilitator.js";

describe("Starknet network registry", () => {
  it("returns Starknet CAIP identifiers", () => {
    expect(getStarknetNetwork("starknet-mainnet")?.caip).toBe(
      "starknet:mainnet"
    );
    expect(getStarknetNetworkCaip("starknet-sepolia")).toBe(
      "starknet:sepolia"
    );
  });

  it("resolves explicit Starknet RPC overrides", () => {
    const rpcUrl = resolveStarknetRpcUrl("starknet-mainnet", {
      explicitUrl: "https://override.example.com",
      alchemyApiKey: "should-not-use",
    });
    expect(rpcUrl).toBe("https://override.example.com");
  });

  it("resolves Alchemy Starknet RPC when API key is provided", () => {
    const rpcUrl = resolveStarknetRpcUrl("starknet-mainnet", {
      alchemyApiKey: "alchemy-key",
    });
    expect(rpcUrl).toBe("https://starknet-mainnet.g.alchemy.com/v2/alchemy-key");
  });

  it("falls back to public Starknet RPC when no overrides are set", () => {
    const rpcUrl = resolveStarknetRpcUrl("starknet-sepolia");
    expect(rpcUrl).toBe("https://starknet-sepolia.public.blastapi.io");
  });

  it("filters unknown Starknet networks", () => {
    const valid = validateStarknetNetworks([
      "starknet-mainnet",
      "starknet-unknown",
    ]);
    expect(valid).toEqual(["starknet-mainnet"]);
  });
});

describe("ExactStarknetScheme supported metadata", () => {
  it("exposes paymaster and sponsor signer data in /supported", () => {
    const config = {
      network: "starknet:mainnet",
      rpcUrl: "https://starknet-mainnet.example.com",
      paymasterEndpoint: "https://starknet.paymaster.avnu.fi",
      sponsorAddress: "0xabc123",
    } as const;

    const facilitator = new x402Facilitator();
    facilitator.register(config.network, new ExactStarknetScheme(config));

    const supported = facilitator.getSupported();
    const kind = supported.kinds.find(
      (entry) => entry.network === config.network && entry.scheme === "exact"
    );

    expect(kind).toBeDefined();
    expect(kind?.extra).toEqual({
      paymasterEndpoint: config.paymasterEndpoint,
      sponsorAddress: config.sponsorAddress,
    });
    expect(supported.signers["starknet:*"]).toEqual([config.sponsorAddress]);
  });
});
