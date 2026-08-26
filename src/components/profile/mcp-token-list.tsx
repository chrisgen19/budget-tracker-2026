"use client";

import { Ban, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { MCP_SCOPE_LABELS, type McpScope } from "@/lib/mcp/scopes";

export interface McpTokenRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  /** What the token represents; stamped onto every transaction it writes. */
  source?: "MCP" | "TELEGRAM";
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;

/** Revoked and expired both mean "this no longer works", but only one of them is reversible
 *  by minting a longer-lived token, so the row says which it is. */
const statusOf = (token: McpTokenRecord): { label: string; dead: boolean } => {
  if (token.revokedAt) return { label: `Revoked ${formatDate(token.revokedAt)}`, dead: true };
  if (token.expiresAt && new Date(token.expiresAt) <= new Date()) {
    return { label: `Expired ${formatDate(token.expiresAt)}`, dead: true };
  }
  const expiry = token.expiresAt ? `Expires ${formatDate(token.expiresAt)}` : "Never expires";
  const used = token.lastUsedAt ? `last used ${formatDate(token.lastUsedAt)}` : "never used";
  return { label: `${expiry} · ${used}`, dead: false };
};

interface McpTokenListProps {
  tokens: McpTokenRecord[];
  revokingId: string | null;
  onRevoke: (token: McpTokenRecord) => void;
}

export function McpTokenList({ tokens, revokingId, onRevoke }: McpTokenListProps) {
  if (tokens.length === 0) {
    return (
      <p className="text-sm text-warm-400 p-4 rounded-xl border border-dashed border-cream-300 text-center">
        No tokens yet. Create one to connect Claude Desktop or Claude Code.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {tokens.map((token) => {
        const status = statusOf(token);
        return (
          <li
            key={token.id}
            className={cn(
              "flex items-start justify-between gap-4 p-4 rounded-xl border border-cream-300 bg-cream-50/50",
              status.dead && "opacity-60"
            )}
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5 text-amber-dark" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-warm-600 truncate">{token.name}</p>
                <p className="text-xs text-warm-400 font-mono">{token.prefix}…</p>
                {token.source === "TELEGRAM" && (
                  <p className="text-xs text-warm-400 mt-1">
                    Writes are tagged &ldquo;Added via Telegram&rdquo;
                  </p>
                )}
                <p className="text-xs text-warm-400 mt-1">{status.label}</p>
                <p className="text-xs text-warm-400 mt-1">
                  {token.scopes
                    .map((scope) => MCP_SCOPE_LABELS[scope as McpScope] ?? scope)
                    .join(" · ")}
                </p>
              </div>
            </div>

            {!status.dead && (
              <button
                type="button"
                onClick={() => onRevoke(token)}
                disabled={revokingId === token.id}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50 shrink-0"
              >
                <Ban className="w-3.5 h-3.5" />
                Revoke
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
