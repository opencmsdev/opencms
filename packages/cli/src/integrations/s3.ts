import type { S3Storage } from "../config.ts";
import { objectStoreEndpoint, probeObjectStore } from "../s3-probe.ts";
import { askSecret, ok, progress, type SetupContext } from "../setup-context.ts";

const S3_SECRETS = ["OPENCMS_S3_ACCESS_KEY_ID", "OPENCMS_S3_SECRET_ACCESS_KEY"];

export type S3Options = {
  bucket: string;
  endpoint?: string;
  region?: string;
  publicBaseUrl?: string;
};

export function s3(options: S3Options): S3Storage {
  return {
    kind: "s3",
    ...options,
    plan() {
      return [
        `store S3 credentials for bucket "${this.bucket}"`,
        `verify ListObjects on "${this.bucket}"`,
      ];
    },
    async setup(ctx) {
      await storeObjectCredentials(ctx, {
        bucket: this.bucket,
        endpoint: this.endpoint,
        region: this.region,
        publicBaseUrl: this.publicBaseUrl,
        accessTitle: "S3 access key id",
        secretTitle: "S3 secret access key",
      });
    },
    async test(ctx) {
      await testObjectStore(ctx, "S3", this.bucket);
    },
  };
}

export async function testObjectStore(ctx: SetupContext, label: string, bucket: string): Promise<void> {
  const store = ctx.store;
  if (!store) {
    throw new Error(`${label} test needs a backend store: run the backend integration first.`);
  }
  const env = store.read();
  const accessKeyId = env.OPENCMS_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.OPENCMS_S3_SECRET_ACCESS_KEY;
  const endpoint = objectStoreEndpoint(env);
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(`${label}: OPENCMS_S3_ACCESS_KEY_ID / OPENCMS_S3_SECRET_ACCESS_KEY are missing.`);
  }
  if (!endpoint) {
    throw new Error(
      `${label}: no endpoint. Set OPENCMS_S3_ENDPOINT, or OPENCMS_S3_ACCOUNT_ID for R2.`,
    );
  }
  progress(ctx, `Testing ${label} "${env.OPENCMS_S3_BUCKET || bucket}"...`);
  await probeObjectStore({
    bucket: env.OPENCMS_S3_BUCKET || bucket,
    endpoint,
    region: env.OPENCMS_S3_REGION,
    accessKeyId,
    secretAccessKey,
    fetch: ctx.fetch,
  });
  ok(ctx, `${label} reachable (${env.OPENCMS_S3_BUCKET || bucket})`);
}

export async function storeObjectCredentials(
  ctx: SetupContext,
  opts: {
    bucket: string;
    endpoint?: string;
    region?: string;
    publicBaseUrl?: string;
    accountId?: string;
    accessTitle: string;
    secretTitle: string;
  },
): Promise<void> {
  const store = ctx.store;
  if (!store) {
    throw new Error("storage setup needs a backend store: run the backend integration first.");
  }
  const existing = store.read();
  const accessKey = await askSecret(ctx.io, opts.accessTitle, existing.OPENCMS_S3_ACCESS_KEY_ID, ctx.yes);
  const secretKey = await askSecret(
    ctx.io,
    opts.secretTitle,
    existing.OPENCMS_S3_SECRET_ACCESS_KEY,
    ctx.yes,
  );
  if (
    (!accessKey || !secretKey) &&
    !(existing.OPENCMS_S3_ACCESS_KEY_ID && existing.OPENCMS_S3_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      `${opts.accessTitle} and secret are required. Re-run without --yes, or set OPENCMS_S3_ACCESS_KEY_ID / OPENCMS_S3_SECRET_ACCESS_KEY.`,
    );
  }

  const values: Record<string, string | undefined> = {
    OPENCMS_S3_BUCKET: opts.bucket,
    OPENCMS_S3_ENDPOINT: opts.endpoint,
    OPENCMS_S3_REGION: opts.region,
    OPENCMS_S3_PUBLIC_BASE_URL: opts.publicBaseUrl,
    OPENCMS_S3_ACCOUNT_ID: opts.accountId,
    OPENCMS_S3_ACCESS_KEY_ID: accessKey,
    OPENCMS_S3_SECRET_ACCESS_KEY: secretKey,
  };
  store.put(values, S3_SECRETS);
  ok(ctx, "Storage credentials stored");
}
