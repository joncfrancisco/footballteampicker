import { CharacterList } from "@ftp/shared";
import lol from "../../seed/league-of-legends/list.json";
import { createApi } from "./app";
import { managedSecret, turnstile } from "./human";
import { S3Publisher } from "./publish";
import { DynamoStore } from "./store";
import type { Event, Result } from "./types";

export type { Event, Result };

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
};

let api: ((e: Event) => Promise<Result>) | undefined;

/** Lambda function URL entry point. CloudFront forwards only `/api/*` here. */
export async function handler(event: Event): Promise<Result> {
  api ??= createApi({
    store: new DynamoStore(env("TABLE")),
    publish: new S3Publisher(env("MEDIA_BUCKET")),
    human: turnstile({
      secret: managedSecret(env("TURNSTILE_SECRET_ID")),
      hostname: env("SITE_HOSTNAME"),
    }),
    seeds: [CharacterList.parse(lol)],
    ipSalt: process.env.IP_SALT,
  });
  return api(event);
}
