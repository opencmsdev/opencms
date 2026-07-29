import { MemoryStorageConnector } from "@opencms/core";
import { runStorageConnectorSuite } from "@opencms/test-kit";

/**
 * The reference implementation held to its own contract.
 *
 * If this goes red the suite and the reference have diverged, and the suite is
 * what every other storage connector is measured against. Fix the pair
 * together, never just whichever connector happened to fail.
 */
runStorageConnectorSuite("memory (reference)", async () => ({
  connector: new MemoryStorageConnector(),
}));
