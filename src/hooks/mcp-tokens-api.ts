import { ApiRefusedError, refusalFrom } from "@/hooks/api-error";
import { fetchPreferences } from "@/hooks/use-preferences";
import type { McpTokenRecord } from "@/components/profile/mcp-token-list";
import type { McpWriteLease } from "@/components/profile/mcp-write-access";
import type { McpScope } from "@/lib/mcp/scopes";
import type { McpTokenSource } from "@/lib/validations";

/*
 * Requests behind Profile > MCP Access.
 *
 * Plain functions rather than React Query hooks: `McpTokensForm` keeps the list in local state
 * on purpose (a minted token's plaintext exists only in that state), so a cache would add a
 * second copy of the list to keep in step without saving a request.
 *
 * Messages are the ones the form showed before these moved here. Where a call ignored the
 * response body on failure it still does, so a server message never replaces a known one.
 */

export interface McpTokenCreateInput {
  name: string;
  scopes: McpScope[];
  expiresInDays: number | null;
  source: McpTokenSource;
}

export const listMcpTokens = async (): Promise<McpTokenRecord[]> => {
  const res = await fetch("/api/mcp/tokens");
  if (!res.ok) throw new ApiRefusedError("Failed to load tokens", res.status);
  return (await res.json()).tokens;
};

/** When the write lease ends, or `null` when writes are off. */
export const fetchMcpWriteLease = async (): Promise<string | null> =>
  (await fetchPreferences()).mcpWritesEnabledUntil ?? null;

/** The plaintext `token` is returned this once and never again. */
export const createMcpToken = async (
  input: McpTokenCreateInput
): Promise<{ token: string; record: McpTokenRecord }> => {
  const res = await fetch("/api/mcp/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiRefusedError("Failed to create token", res.status);
  return res.json();
};

export const revokeMcpToken = async (id: string): Promise<McpTokenRecord> => {
  const res = await fetch(`/api/mcp/tokens/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiRefusedError("Failed to revoke token", res.status);
  return (await res.json()).record;
};

/** Re-date a live token from today. The server explains a refusal (409 for a dead token). */
export const changeMcpTokenExpiry = async (
  id: string,
  expiresInDays: number | null
): Promise<McpTokenRecord> => {
  const res = await fetch(`/api/mcp/tokens/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresInDays }),
  });
  if (!res.ok) throw await refusalFrom(res, "Failed to change expiry");
  return (await res.json()).record;
};

/** Remove a dead token for good. The API refuses a live one. */
export const deleteMcpToken = async (id: string): Promise<void> => {
  const res = await fetch(`/api/mcp/tokens/${id}?permanent=true`, { method: "DELETE" });
  if (!res.ok) throw new ApiRefusedError("Failed to delete token", res.status);
};

/** Set or end the write lease. Resolves to when it now ends, or `null` when writes are off. */
export const setMcpWriteLease = async (lease: McpWriteLease): Promise<string | null> => {
  const res = await fetch("/api/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mcpWriteMinutes: lease }),
  });
  if (!res.ok) throw new ApiRefusedError("Failed to update write access", res.status);
  return (await res.json()).mcpWritesEnabledUntil ?? null;
};
