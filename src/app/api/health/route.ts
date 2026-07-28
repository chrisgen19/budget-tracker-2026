import { NextResponse } from "next/server";

// Pinned so the probe always executes at request time. A statically optimized
// response would still return 200 from a server that had stopped working.
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Container liveness probe for the Coolify/Docker healthcheck. Deliberately
 * touches neither the database nor auth: every app on this host shares one
 * Postgres instance, so a deep check would mark them all unhealthy during a
 * single database blip and restart the lot at once. This answers only "is the
 * server serving HTTP?".
 */
export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
