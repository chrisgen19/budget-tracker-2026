"use client";

import { useState } from "react";
import { Ban, ChevronDown, ChevronRight, KeyRound, Trash2 } from "lucide-react";
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

export const isDeadToken = (token: McpTokenRecord): boolean => statusOf(token).dead;

interface McpTokenListProps {
  tokens: McpTokenRecord[];
  revokingId: string | null;
  deletingId: string | null;
  onRevoke: (token: McpTokenRecord) => void;
  /** Only offered for tokens that are already dead; the API refuses a live one. */
  onDelete: (token: McpTokenRecord) => void;
}

export function McpTokenList({
  tokens,
  revokingId,
  deletingId,
  onRevoke,
  onDelete,
}: McpTokenListProps) {
  /**
   * Dead tokens are collapsed rather than listed alongside the live ones.
   *
   * They are kept deliberately, so the row can still answer what a leaked credential was allowed
   * to do. But a token that cannot be used is not something the user is choosing between, and
   * after a few rotations the working ones are buried under the retired ones.
   */
  const [showDead, setShowDead] = useState(false);

  if (tokens.length === 0) {
    return (
      <p className="text-sm text-warm-400 p-4 rounded-xl border border-dashed border-cream-300 text-center">
        No tokens yet. Create one to connect Claude Desktop or Claude Code.
      </p>
    );
  }

  const live = tokens.filter((token) => !statusOf(token).dead);
  const dead = tokens.filter((token) => statusOf(token).dead);

  const row = (token: McpTokenRecord) => {
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
              {token.scopes.map((scope) => MCP_SCOPE_LABELS[scope as McpScope] ?? scope).join(" · ")}
            </p>
          </div>
        </div>

        {status.dead ? (
          <button
            type="button"
            onClick={() => onDelete(token)}
            disabled={deletingId === token.id}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-warm-400 hover:text-red-600 disabled:opacity-50 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        ) : (
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
  };

  return (
    <div className="space-y-3">
      {live.length > 0 ? (
        <ul className="space-y-3">{live.map(row)}</ul>
      ) : (
        <p className="text-sm text-warm-400 p-4 rounded-xl border border-dashed border-cream-300 text-center">
          No tokens in use. Create one to connect Claude Desktop or Claude Code.
        </p>
      )}

      {dead.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDead((open) => !open)}
            aria-expanded={showDead}
            className="inline-flex items-center gap-1 text-xs font-medium text-warm-400 hover:text-warm-600"
          >
            {showDead ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            {dead.length} revoked or expired
          </button>

          {showDead && (
            <>
              <ul className="space-y-3 mt-3">{dead.map(row)}</ul>
              <p className="text-xs text-warm-400 mt-3">
                These cannot be used. Deleting one removes it from this list for good; any
                transactions it created stay exactly as they are, but you will no longer be able
                to tell which token wrote them.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
