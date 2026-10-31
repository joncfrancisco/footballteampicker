// #17 "done when": a single-IP flood gets 403s from WAF within 5 minutes.
//
//   k6 run loadtest/flood.js
//
// Run OUTSIDE a load-test window (WAF rate rules must be blocking). It blocks the IP you run
// it from for about five minutes afterwards, site included. ~15k API invocations: cents.
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";
import { BASE } from "./common.js";

export const options = {
  scenarios: {
    flood: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: __ENV.DURATION || "6m",
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
  thresholds: { waf_blocked: ["count>0"], blocked_after_s: ["min<300"] },
};

const blocked = new Counter("waf_blocked");
// Seconds from the start of the flood to each 403; its min is the time WAF took to react.
const blockedAfter = new Trend("blocked_after_s");

export function setup() {
  if (http.get(`${BASE}/api/health`).json("loadtest"))
    throw new Error("A load-test window is open: WAF is only counting. Close it first.");
  return { started: Date.now() };
}

export default function (data) {
  const r = http.get(`${BASE}/api/health`, { tags: { name: "flood" } });
  if (r.status === 403) {
    blocked.add(1);
    blockedAfter.add((Date.now() - data.started) / 1000);
  }
}
