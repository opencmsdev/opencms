/**
 * Runs the cache conformance suite against a REAL Workers KV namespace:
 * Miniflare boots workerd locally and hands back the same KVNamespace object
 * a deployed Worker receives, exactly as the D1 conformance test does for its
 * database. If this passes, the connector is proven against Cloudflare's
 * actual engine, not a lookalike.
 */
import { Miniflare } from "miniflare";
import { runCacheConnectorSuite } from "@opencms/test-kit";
import { KVCacheConnector, type KVNamespaceLike } from "@opencms/connector-kv";

runCacheConnectorSuite("cloudflare-kv (miniflare/workerd)", async () => {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response(null); } };",
    kvNamespaces: ["CACHE"],
  });
  const kv = (await mf.getKVNamespace("CACHE")) as unknown as KVNamespaceLike;
  return {
    connector: new KVCacheConnector(kv),
    cleanup: async () => {
      await mf.dispose();
    },
  };
});
