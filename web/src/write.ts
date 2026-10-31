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
  const response = await fetch(path, {
    method: options.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "x-turnstile-token": token,
      "x-amz-content-sha256": hash,
      ...(options.editToken ? { authorization: `Bearer ${options.editToken}` } : {}),
    },
    body: serialized,
  });
  const result = (await response.json().catch(() => ({}))) as {
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
  if (!response.ok) throw new WriteError(response.status, result.error ?? "unknown");
  return result;
}
import type { ListInput } from "@ftp/shared";
