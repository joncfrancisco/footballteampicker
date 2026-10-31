// 100 concurrent users for 10 minutes, each running the real flow (#18):
// open home → open a list → build → share 1 in 3 → open a team link → browse.
//
//   LOADTEST_TOKEN=... k6 run loadtest/flow.js
//
// Only during a load-test window (DEPLOY.md): from one machine every request shares an IP, so
// WAF rate rules must be counting and the API must accept the token.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { BASE, fixture, postTeam, randomTeam, requireToken } from "./common.js";

export const options = {
  scenarios: {
    users: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 100),
      duration: __ENV.DURATION || "10m",
    },
  },
  thresholds: {
    server_errors: ["count==0"],
    "http_req_duration{kind:api}": ["p(95)<1000"],
    "http_req_waiting{kind:static}": ["p(95)<300"],
    checks: ["rate>0.99"],
  },
};

const seedAtlas = JSON.parse(open("../seed/league-of-legends/list.json")).atlas.src;
const serverErrors = new Counter("server_errors");
const shares = new Counter("shares");

export function setup() {
  requireToken();
  const health = http.get(`${BASE}/api/health`);
  if (!health.json("loadtest")) throw new Error("The API isn't in a load-test window");
  // Find the hashed bundle and the seed atlas the way a browser would.
  const html = http.get(`${BASE}/`).body;
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const atlas = `/m/seeds/${fixture.listId}/${seedAtlas}`;
  // One shared team every VU can open as "a link someone sent me".
  const seeded = postTeam(randomTeam(), { name: "setup" });
  if (seeded.status !== 201) throw new Error(`setup share failed: ${seeded.status} ${seeded.body}`);
  return { assets, atlas, teamId: seeded.json("id") };
}

function get(path, kind = "static", name = path, ok = [200]) {
  const r = http.get(`${BASE}${path}`, { tags: { kind, name } });
  if (r.status >= 500) serverErrors.add(1, { name });
  check(r, { [`${name} ok`]: (x) => ok.includes(x.status) });
  return r;
}

// The browse index doesn't exist until the first public list is saved; the app shows none.
const browse = () => get("/m/browse/index.json", "static", "browse", [200, 404]);

export default function (data) {
  // Home. Returning visitors have the hashed bundle cached; a VU fetches it on its first visit.
  get("/", "static", "html");
  if (__ITER === 0) for (const a of data.assets) get(a, "static", "asset");
  browse();
  sleep(3 + Math.random() * 7);

  // Open the seed list: its roster ships in the bundle, its portraits are one atlas.
  if (__ITER === 0) get(data.atlas, "static", "atlas");

  // Build: drag and drop is all client-side.
  sleep(20 + Math.random() * 40);

  // Share 1 in 3, then open the link like the recipient would.
  let teamId = data.teamId;
  if (Math.random() < 1 / 3) {
    const r = postTeam(randomTeam());
    if (r.status >= 500) serverErrors.add(1, { name: "POST /api/teams" });
    check(r, { "share ok": (x) => x.status === 201 });
    if (r.status === 201) {
      shares.add(1);
      teamId = r.json("id");
    }
  }
  get(`/t/${teamId}`, "static", "team html");
  get(`/m/t/${teamId}.json`, "static", "team json");
  sleep(5 + Math.random() * 10);

  browse();
  sleep(5 + Math.random() * 10);
}
