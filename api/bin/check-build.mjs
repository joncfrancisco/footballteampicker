// Exercise the actual ESM bundle: unit tests alone cannot catch packaged SDK require errors.
import assert from "node:assert/strict";
import process from "node:process";
import { handler } from "../dist/index.mjs";

Object.assign(process.env, {
  TABLE: "footballteampicker-build-check",
  MEDIA_BUCKET: "footballteampicker-build-check",
  SITE_HOSTNAME: "localhost",
  TURNSTILE_SECRET_PARAM: "/footballteampicker/build-check",
  AWS_REGION: "us-east-1",
  ALERTS_TOPIC: "arn:aws:sns:us-east-1:020949219706:footballteampicker-build-check",
});
const result = await handler({
  rawPath: "/api/health",
  requestContext: { http: { method: "GET" } },
});
assert.equal(result.statusCode, 200);
// No LOADTEST_TOKEN_PARAM, as in normal production: no load-test window (#18).
assert.deepEqual(JSON.parse(result.body), { ok: true, loadtest: false });
const { handler: kill } = await import("../dist/kill.mjs");
assert.deepEqual(await kill({ Records: [] }), { paused: false });
