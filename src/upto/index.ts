import { InMemoryUptoSessionStore } from "./sessionStore.js";
import { createUptoSweeper } from "./sweeper.js";
import { localFacilitatorClient } from "../localFacilitatorClient.js";

export const uptoStore = new InMemoryUptoSessionStore();

export const uptoSweeper = createUptoSweeper({
  store: uptoStore,
  facilitatorClient: localFacilitatorClient,
});

