import { MemoryDataConnector } from "@opencms/core";
import { runDataConnectorSuite } from "@opencms/test-kit";

runDataConnectorSuite("memory (reference)", async () => ({
  connector: new MemoryDataConnector(),
  cleanup: async (c) => c.close(),
}));
