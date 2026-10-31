import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type Event = APIGatewayProxyEventV2;
export type Result = APIGatewayProxyStructuredResultV2;

function json(statusCode: number, body: unknown): Result {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

/** Lambda function URL entry point. CloudFront forwards only `/api/*` here. */
export async function handler(event: Event): Promise<Result> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (path === "/api/health" && method === "GET") {
    return json(200, { ok: true });
  }
  return json(404, { error: "not_found" });
}
