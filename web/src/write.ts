export class WriteError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(
      status === 429 || status === 503
        ? "Sharing is paused, try again later. Your draft is still here; you can export an image."
        : status === 409
          ? "This list changed. Reload the list before sharing."
          : status === 403
            ? "Please complete a new human verification and try again."
            : "Could not save. Please try again.",
    );
  }
}

/** CloudFront's Lambda OAC requires the SHA-256 of every non-empty request body. */
export async function writeJson(
  path: string,
  body: unknown,
  token: string,
  options: { method?: string; editToken?: string } = {},
) {
  const serialized = JSON.stringify(body);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  const hash = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
  const send = () =>
    fetch(path, {
      method: options.method ?? "POST",
      headers: {
        "content-type": "application/json",
        "x-turnstile-token": token,
        "x-amz-content-sha256": hash,
        ...(options.editToken ? { authorization: `Bearer ${options.editToken}` } : {}),
      },
      body: serialized,
    });
  let response = await send();
  let result = await readBody(response);
  // A 429/503 without our `error` body came from Lambda's concurrency cap or CloudFront, so
  // the API never ran and the Turnstile token is unused: retry it (#18). An API answer, or a
  // write paused by the kill switch, is final.
  for (let attempt = 0; attempt < RETRIES && unreached(response, result); attempt++) {
    await sleep(RETRY_BASE_MS * 2 ** attempt * (0.5 + Math.random()));
    response = await send();
    result = await readBody(response);
  }
  if (!response.ok) throw new WriteError(response.status, result.error ?? "unknown");
  return result;
}

const RETRIES = 3;
const RETRY_BASE_MS = 300;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function unreached(response: Response, result: { error?: string }) {
  return (response.status === 429 || response.status === 503) && !result.error;
}

async function readBody(response: Response) {
  return (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: string;
    editToken?: string;
    version?: number;
    key?: string;
    uploadToken?: string;
    url?: string;
    fields?: Record<string, string>;
    atlas?: ListInput["atlas"];
  };
}
import type { ListInput } from "@ftp/shared";
