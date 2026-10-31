/**
 * Local dev server: the same API as production, wrapped in plain Node http, with an
 * in-memory store and publisher and Cloudflare's always-pass Turnstile test secret. It also
 * serves the published /m/* objects, so the web app reads them exactly as it would from
 * CloudFront. Vite proxies /api and /m here.
 */
import { CharacterList } from "@ftp/shared";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import lol from "../../seed/league-of-legends/list.json";
import { createApi } from "./app";
import { TEST_SECRET, turnstile } from "./human";
import { MemoryPublisher } from "./publish";
import { MemoryStore } from "./store";
import type { Event } from "./types";
import { Media, MemoryMedia, MAX_ATLAS } from "./media";

const PORT = Number(process.env.API_PORT ?? 8787);
const publish = new MemoryPublisher();
const store = new MemoryStore();
const media = new MemoryMedia();
const api = createApi({
  store,
  media: new Media(store, media),
  publish,
  human: turnstile({ secret: async () => TEST_SECRET, hostname: "localhost" }),
  seeds: [CharacterList.parse(lol)],
  ipSalt: "local-development-only",
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === `/m/seeds/${lol.id}/${lol.atlas.src}`) {
    res.writeHead(200, {
      "content-type": "image/webp",
      "cache-control": "public,max-age=31536000,immutable",
    });
    return res.end(
      await readFile(new URL(`../../seed/league-of-legends/${lol.atlas.src}`, import.meta.url)),
    );
  }

  if (req.method === "GET" && url.pathname.startsWith("/m/")) {
    const image = media.objects.get(url.pathname.slice(1));
    if (image) {
      res.writeHead(200, {
        "content-type": image.contentType,
        "cache-control": "public,max-age=31536000,immutable",
      });
      return res.end(image.bytes);
    }
    const o = publish.objects.get(url.pathname.slice(1));
    res.writeHead(o ? 200 : 404, {
      "content-type": "application/json",
      ...(o ? { "cache-control": o.cacheControl } : {}),
    });
    return res.end(o?.body ?? "");
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += (chunk as Buffer).length;
    if (length > MAX_ATLAS + 64 * 1024) {
      res.writeHead(413);
      return res.end();
    }
    chunks.push(chunk as Buffer);
  }
  if (req.method === "POST" && url.pathname.startsWith("/api/local-upload/")) {
    const key = `tmp/${url.pathname.split("/").pop()}`;
    const mime = media.pending.get(key);
    if (!mime) {
      res.writeHead(403);
      return res.end();
    }
    try {
      const form = await new Request(url, {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] ?? "" },
        body: Buffer.concat(chunks),
      }).formData();
      const file = form.get("file");
      if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_ATLAS || file.type !== mime) {
        res.writeHead(400);
        return res.end();
      }
      await media.put(key, { bytes: new Uint8Array(await file.arrayBuffer()), contentType: mime });
      res.writeHead(204);
      return res.end();
    } catch {
      res.writeHead(400);
      return res.end();
    }
  }
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
