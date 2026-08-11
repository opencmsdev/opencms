import { MemoryCacheConnector } from "@opencms/core";
import { runCacheConnectorSuite } from "@opencms/test-kit";

/**
 * The reference implementation held to its own contract, like the data and
 * storage references beside it. Exact TTL expiry lives in core's own tests,
 * where the clock is injectable.
 */
runCacheConnectorSuite("memory (reference)", async () => ({
  connector: new MemoryCacheConnector(),
}));
