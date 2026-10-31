// Shared helpers for the k6 scripts (#18). k6 runs its own JS runtime, not Node.
import http from "k6/http";
import crypto from "k6/crypto";
import { sleep } from "k6";

export const BASE = (__ENV.BASE_URL || "https://depthchart.joncfrancis.co").replace(/\/$/, "");
export const TOKEN = __ENV.LOADTEST_TOKEN;
export const fixture = JSON.parse(open("./teams.json"));

export function requireToken() {
  if (!TOKEN) throw new Error("Set LOADTEST_TOKEN (bin/loadtest prints it during a window)");
}

/** POST a team the way the web app does: the body hash is required by Lambda OAC. */
export function postTeam(team, tags = {}) {
  const body = JSON.stringify(team);
  return http.post(`${BASE}/api/teams`, body, {
    headers: {
      "content-type": "application/json",
      "x-amz-content-sha256": crypto.sha256(body, "hex"),
      "x-loadtest-token": TOKEN,
    },
    tags: { kind: "api", name: "POST /api/teams", ...tags },
  });
}

/**
 * The web client's retry rule (web/src/ShareMenu.tsx): a 429 or 503 is retried up to 3 times,
 * 500 ms × 2^attempt plus up to 400 ms of jitter. The browser gets a fresh Turnstile token for
 * each retry; the load-test token is reusable.
 */
export function postTeamWithRetry(team, tags) {
  let r = postTeam(team, tags);
  let retries = 0;
  while (retries < 3 && (r.status === 429 || r.status === 503)) {
    sleep((500 * 2 ** retries + Math.random() * 400) / 1000);
    r = postTeam(team, tags);
    retries++;
  }
  return { response: r, retries };
}

export function randomTeam() {
  const team = fixture.teams[Math.floor(Math.random() * fixture.teams.length)];
  return { ...team, title: `Load test ${Math.random().toString(36).slice(2, 8)}` };
}
