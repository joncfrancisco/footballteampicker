import { CharacterList } from "@ftp/shared";
import lol from "../../seed/league-of-legends/list.json";
import { createApi } from "./app";
import { ssmSecret, turnstile } from "./human";
import { S3Publisher } from "./publish";
import { DynamoStore } from "./store";
import type { Event, Result } from "./types";
import { Media, S3Media } from "./media";

export type { Event, Result };

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
};

let api: ((e: Event) => Promise<Result>) | undefined;

/** Lambda function URL entry point. CloudFront forwards only `/api/*` here. */
export async function handler(event: Event): Promise<Result> {
  if (!api) {
    const store = new DynamoStore(env("TABLE"));
    api = createApi({
      store,
      media: new Media(store, new S3Media(env("MEDIA_BUCKET"))),
      publish: new S3Publisher(env("MEDIA_BUCKET")),
      human: turnstile({
        secret: ssmSecret(env("TURNSTILE_SECRET_PARAM")),
        hostname: env("SITE_HOSTNAME"),
      }),
      seeds: [CharacterList.parse(lol)],
      reporterSalt: ssmSecret("/footballteampicker/ip-salt"),
      logRequest: (record) => console.info(JSON.stringify(record)),
      // Set only while Terraform's loadtest_mode is on (#18).
      ...(process.env.LOADTEST_TOKEN_PARAM
        ? { loadtestToken: ssmSecret(process.env.LOADTEST_TOKEN_PARAM) }
        : {}),
    });
  }
  return api(event);
}
