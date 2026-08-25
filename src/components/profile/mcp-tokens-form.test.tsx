import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { McpTokensForm } from "@/components/profile/mcp-tokens-form";

/**
 * The token list and the write lease come from different endpoints.
 *
 * They used to share one try/catch, so a preferences outage hid the token list behind "could not
 * load your tokens" even though `/api/mcp/tokens` had answered. That removes the ability to revoke
 * a credential, which is the action most likely to be urgent, and it is a worse failure than the
 * misreported lease state the shared catch was introduced to fix.
 */

const TOKEN = {
  id: "tok_1",
  name: "Laptop token",
  prefix: "btmcp_abc123",
  scopes: ["budget:read"],
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

const fail = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);

/** Route each endpoint independently so either can be failed on its own. */
const stubFetch = (opts: { tokens: boolean; prefs: boolean }) =>
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/mcp/tokens")) {
        return opts.tokens ? ok({ tokens: [TOKEN] }) : fail();
      }
      if (url.includes("/api/preferences")) {
        return opts.prefs ? ok({ mcpWritesEnabledUntil: null }) : fail();
      }
      return fail();
    })
  );

afterEach(() => vi.unstubAllGlobals());

describe("McpTokensForm load failures", () => {
  it("keeps the token list usable when only the lease read fails", async () => {
    stubFetch({ tokens: true, prefs: false });

    render(<McpTokensForm />);

    // The token is still listed, so it can still be revoked.
    await waitFor(() => expect(screen.getByText("Laptop token")).toBeDefined());
    expect(screen.queryByText("Could not load your tokens.")).toBeNull();

    // And the lease reads as unknown rather than as the reassuring "off".
    expect(screen.getByText("Could not read write access state.")).toBeDefined();
    expect(screen.queryByText(/cannot create transactions/)).toBeNull();
  });

  it("keeps the lease panel usable when only the token read fails", async () => {
    stubFetch({ tokens: false, prefs: true });

    render(<McpTokensForm />);

    await waitFor(() => expect(screen.getByText("Could not load your tokens.")).toBeDefined());

    // The lease loaded, so it reports its real state instead of an unknown one.
    expect(screen.queryByText("Could not read write access state.")).toBeNull();
    expect(screen.getByText(/cannot create transactions/)).toBeDefined();
  });

  it("reports both independently when both fail", async () => {
    stubFetch({ tokens: false, prefs: false });

    render(<McpTokensForm />);

    await waitFor(() => expect(screen.getByText("Could not load your tokens.")).toBeDefined());
    expect(screen.getByText("Could not read write access state.")).toBeDefined();
  });

  it("reports nothing when both succeed", async () => {
    stubFetch({ tokens: true, prefs: true });

    render(<McpTokensForm />);

    await waitFor(() => expect(screen.getByText("Laptop token")).toBeDefined());
    expect(screen.queryByText(/Could not load/)).toBeNull();
    expect(screen.queryByText(/Could not read/)).toBeNull();
  });
});
