import { test } from "bun:test";
import { runDataConnectorSuite } from "@opencms/test-kit";
import { PostgresDataConnector } from "@opencms/connector-postgres";

/**
 * The full connector conformance suite against a REAL Postgres.
 *
 * Skipped unless `OPENCMS_PG_TEST_URL` points at a throwaway database, so CI
 * and a plain `bun run test:all` stay green without a server. Run it before
 * believing any change to this connector:
 *
 *   OPENCMS_PG_TEST_URL=postgres://user@127.0.0.1:5432/opencms_test \
 *     bun test packages/connector-postgres/test/conformance.test.ts
 *
 * Supabase note: the pooled connection string (port 6543) also passes, but a
 * throwaway local server is faster and cannot touch anything real.
 *
 * Every harness drops and recreates the two tables, because unlike the
 * in-memory SQLite harness a Postgres database persists between tests.
 */

const url = process.env.OPENCMS_PG_TEST_URL;

if (!url) {
  test.skip("postgres conformance (set OPENCMS_PG_TEST_URL to run)", () => {});
} else {
  runDataConnectorSuite("postgres (live)", async () => {
    const connector = new PostgresDataConnector({ url, max: 4 });
    await connector.db.unsafe("DROP TABLE IF EXISTS entries");
    await connector.db.unsafe("DROP TABLE IF EXISTS content_types");
    await connector.init();
    return {
      connector,
      cleanup: async () => {
        await connector.close();
      },
    };
  });
}
