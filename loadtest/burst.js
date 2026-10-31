// Every user presses Share in the same second (#18): 100 full teams with special teams and
// staff at once. Pass: every share succeeds within 3 retries, as the web client retries.
//
//   LOADTEST_TOKEN=... k6 run loadtest/burst.js
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";
import { BASE, postTeamWithRetry, randomTeam, requireToken } from "./common.js";

export const options = {
  scenarios: {
    burst: { executor: "per-vu-iterations", vus: 100, iterations: 1, maxDuration: "1m" },
  },
  thresholds: {
    "checks{check:shared}": ["rate==1"],
    retries: ["max<=3"],
  },
};

const retries = new Trend("retries");
const throttled = new Counter("throttled_attempts");

export function setup() {
  requireToken();
  if (!http.get(`${BASE}/api/health`).json("loadtest"))
    throw new Error("The API isn't in a load-test window");
}

export default function () {
  const { response, retries: n } = postTeamWithRetry(randomTeam(), { name: "burst" });
  retries.add(n);
  if (n) throttled.add(n);
  check(response, { shared: (r) => r.status === 201 }, { check: "shared" });
}
