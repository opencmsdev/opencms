/**
 * Runs the full connector conformance suite against a REAL D1 instance:
 * Miniflare boots workerd locally and hands back the same D1Database object
 * a deployed Worker receives. If this passes, the SQL dialect and the
 * connector are proven against Cloudflare's actual engine, not a lookalike.
 */
import { Miniflare } from "miniflare";
import { runDataConnectorSuite } from "@opencms/test-kit";
import { D1DataConnector, type D1DatabaseLike } from "@opencms/connector-d1";

runDataConnectorSuite("cloudflare-d1 (miniflare/workerd)", async () => {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response(null); } };",
    d1Databases: { DB: ":memory:" },
  });
  const db = (await mf.getD1Database("DB")) as unknown as D1DatabaseLike;
  return {
    connector: new D1DataConnector(db),
    cleanup: async () => {
      await mf.dispose();
    },
  };
});
