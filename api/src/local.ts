/**
 * Local dev server: the same API as production, wrapped in plain Node http, with an
 * in-memory store and publisher and Cloudflare's always-pass Turnstile test secret. It also
 * serves the published /m/* objects, so the web app reads them exactly as it would from
 * CloudFront. Vite proxies /api and /m here.
 */
import { CharacterList } from "@ftp/shared";
import { createServer } from "node:http";
import lol from "../../seed/league-of-legends/list.json";
import { createApi } from "./app";
import { TEST_SECRET, turnstile } from "./human";
import { MemoryPublisher } from "./publish";
import { MemoryStore } from "./store";
import type { Event } from "./types";

const PORT = Number(process.env.API_PORT ?? 8787);
const publish = new MemoryPublisher();
const api = createApi({
  store: new MemoryStore(),
  publish,
  human: turnstile({ secret: async () => TEST_SECRET, hostname: "localhost" }),
  seeds: [CharacterList.parse(lol)],
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname.startsWith("/m/")) {
    const o = publish.objects.get(url.pathname.slice(1));
    res.writeHead(o ? 200 : 404, {
      "content-type": "application/json",
      ...(o ? { "cache-control": o.cacheControl } : {}),
    });
    return res.end(o?.body ?? "");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  const event = {
    version: "2.0",
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
    ),
    queryStringParameters: Object.fromEntries(url.searchParams),
    requestContext: {
      http: {
        method: req.method ?? "GET",
        path: url.pathname,
        sourceIp: req.socket.remoteAddress ?? "127.0.0.1",
      },
    },
    body: body || undefined,
    isBase64Encoded: false,
  } as unknown as Event;

  const result = await api(event);
  res.writeHead(result.statusCode ?? 200, result.headers as Record<string, string>);
  res.end(result.body ?? "");
}).listen(PORT, () => console.log(`api listening on http://localhost:${PORT}`));
