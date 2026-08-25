"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plug } from "lucide-react";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { McpTokenCreate } from "@/components/profile/mcp-token-create";
import { McpTokenList, type McpTokenRecord } from "@/components/profile/mcp-token-list";
import { McpWriteAccess } from "@/components/profile/mcp-write-access";
import type { McpScope } from "@/lib/mcp/scopes";

interface CreateInput {
  name: string;
  scopes: McpScope[];
  expiresInDays: number | null;
}

export function McpTokensForm() {
  const [tokens, setTokens] = useState<McpTokenRecord[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<McpTokenRecord | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [writesUntil, setWritesUntil] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp/tokens");
      if (!res.ok) throw new Error("Failed to load tokens");
      const data = await res.json();
      setTokens(data.tokens);
      setLoadFailed(false);

      // The lease lives on the user, not the token list, so it is read separately.
      const prefs = await fetch("/api/preferences");
      if (prefs.ok) setWritesUntil((await prefs.json()).mcpWritesEnabledUntil ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tokens");
      // Deliberately not `setTokens([])`: an empty list renders "No tokens yet", which would tell
      // a user whose fetch just failed that they have none and invite a duplicate mint.
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Resolves to whether a token was actually minted, so a failed create does not make the
   *  user retype the name before retrying. */
  const handleCreate = async (input: CreateInput): Promise<boolean> => {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/mcp/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to create token");
      const data = await res.json();
      // Held in state, not refetchable: this is the only time the plaintext exists outside
      // the user's clipboard.
      setMinted(data.token);
      setCopied(false);
      setTokens((current) => [data.record, ...(current ?? [])]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create token");
      return false;
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    setRevokingId(revoking.id);
    setError("");
    try {
      const res = await fetch(`/api/mcp/tokens/${revoking.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke token");
      const data = await res.json();
      setTokens((current) =>
        (current ?? []).map((token) => (token.id === data.record.id ? data.record : token))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
    } finally {
      setRevokingId(null);
      setRevoking(null);
    }
  };

  const handleWriteLease = async (minutes: number | null) => {
    setError("");
    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpWriteMinutes: minutes }),
      });
      if (!res.ok) throw new Error("Failed to update write access");
      setWritesUntil((await res.json()).mcpWritesEnabledUntil ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update write access");
    }
  };

  const handleCopy = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted);
      setCopied(true);
    } catch {
      // Rejects on an insecure origin or a denied permission. The token is on screen either
      // way, so say so rather than leaving the button silently inert.
      setError("Could not copy the token. Select it above and copy it manually.");
    }
  };

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-serif text-lg text-warm-700">MCP access tokens</h2>
        <p className="text-sm text-warm-400 mt-0.5">
          Let Claude Desktop or Claude Code read your budget. Each token is a password to
          everything you grant it, so scope it narrowly and revoke it when you are done.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4 p-3 rounded-xl bg-red-50 border border-red-200">
          {error}
        </p>
      )}

      {minted && (
        <div className="mb-5 p-4 rounded-xl border border-amber bg-amber-light/40 space-y-3">
          <p className="text-sm font-medium text-warm-700">
            Copy this now. It is not stored and will not be shown again.
          </p>
          <code className="block text-xs font-mono break-all text-warm-700 bg-white/70 p-3 rounded-lg">
            {minted}
          </code>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber hover:bg-amber-dark text-white text-xs font-medium transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => setMinted(null)}
              className="px-3 py-2 rounded-lg border border-cream-300 text-warm-500 text-xs font-medium hover:bg-cream-100 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="space-y-5">
        <McpWriteAccess enabledUntil={writesUntil} onChange={handleWriteLease} />

        <McpTokenCreate onCreate={handleCreate} creating={creating} />

        {loadFailed ? (
          <div className="p-4 rounded-xl border border-dashed border-cream-300 text-center">
            <p className="text-sm text-warm-400">Could not load your tokens.</p>
            <button
              type="button"
              onClick={load}
              className="mt-2 text-xs font-medium text-amber-dark hover:text-amber underline"
            >
              Try again
            </button>
          </div>
        ) : tokens === null ? (
          <div className="space-y-3" aria-hidden>
            <div className="h-20 bg-cream-200 rounded-xl animate-shimmer" />
            <div className="h-20 bg-cream-200 rounded-xl animate-shimmer" />
          </div>
        ) : (
          <McpTokenList tokens={tokens} revokingId={revokingId} onRevoke={setRevoking} />
        )}

        <p className="text-xs text-warm-400 flex items-start gap-1.5">
          <Plug className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Point your client at <code className="font-mono">/api/mcp</code> and send the token as{" "}
          <code className="font-mono">Authorization: Bearer …</code>. Claude Desktop and Claude
          Code support this directly; claude.ai on web and mobile needs request-header
          authentication enabled on the account.
        </p>
      </div>

      <ConfirmModal
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={handleRevoke}
        title="Revoke this token?"
        message={
          <>
            Any client using <strong>{revoking?.name}</strong> stops working immediately. This
            cannot be undone, and you would need to create a new token.
          </>
        }
        confirmLabel="Revoke"
        loading={revokingId !== null}
      />
    </div>
  );
}
