/**
 * Local dev server: wraps the Lambda handler in plain Node http so `npm run dev`
 * exercises the same code path as the function URL. Vite proxies `/api` here.
 */
import { createServer } from "node:http";
import { handler, type Event } from "./handler";

const PORT = Number(process.env.API_PORT ?? 8787);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
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

  const result = await handler(event);
  res.writeHead(result.statusCode ?? 200, result.headers as Record<string, string>);
  res.end(result.body ?? "");
}).listen(PORT, () => console.log(`api listening on http://localhost:${PORT}`));
