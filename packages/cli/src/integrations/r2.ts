import { existsSync } from "node:fs";
import type { R2Storage } from "../config.ts";
import { ok, workerDir } from "../setup-context.ts";
import { parseAccountId, wranglerInvocation } from "../wrangler.ts";
import { storeObjectCredentials, testObjectStore } from "./s3.ts";

export type R2Options = {
  bucket: string;
  publicBaseUrl?: string;
};

export function r2(options: R2Options): R2Storage {
  return {
    kind: "r2",
    ...options,
    plan() {
      return [
        `create R2 bucket "${this.bucket}"`,
        "store R2 API tokens",
        `verify ListObjects on "${this.bucket}"`,
      ];
    },
    async setup(ctx) {
      const dir = existsSync(workerDir(ctx.cwd)) ? workerDir(ctx.cwd) : ctx.cwd;
      const created = wranglerInvocation(ctx.run, ["r2", "bucket", "create", this.bucket], { cwd: dir });
      const textOut = `${created.stdout}\n${created.stderr}`;
      if (created.status !== 0 && !/already exists|already been created/i.test(textOut)) {
        throw new Error(`wrangler r2 bucket create failed: ${textOut.trim()}`);
      }
      ok(ctx, `R2 bucket "${this.bucket}"`);

      const whoami = wranglerInvocation(ctx.run, ["whoami"], { cwd: dir });
      const accountId = parseAccountId(whoami.stdout + whoami.stderr);
      await storeObjectCredentials(ctx, {
        bucket: this.bucket,
        endpoint: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined,
        region: "auto",
        publicBaseUrl: this.publicBaseUrl,
        accountId,
        accessTitle: "R2 access key id",
        secretTitle: "R2 secret access key",
      });
    },
    async test(ctx) {
      await testObjectStore(ctx, "R2", this.bucket);
    },
  };
}
