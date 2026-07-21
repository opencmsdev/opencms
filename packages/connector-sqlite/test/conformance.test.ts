import { runDataConnectorSuite } from "@opencms/test-kit";
import { SQLiteDataConnector } from "@opencms/connector-sqlite";

runDataConnectorSuite("sqlite (in-memory)", async () => ({
  connector: new SQLiteDataConnector(),
  cleanup: async (c) => c.close(),
}));
