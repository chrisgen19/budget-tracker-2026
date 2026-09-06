"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MINT_SCOPES,
  MCP_SCOPES,
  MCP_SCOPE_LABELS,
  grantsWrite,
  isWriteScope,
  type McpScope,
} from "@/lib/mcp/scopes";
import type { McpTokenSource } from "@/lib/validations";

const INPUT_CLASS =
  "w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all";

/** Bounded by default: an unbounded credential should be a deliberate choice, not the path
 *  of least resistance. `null` is the "never expires" option. */
const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "Never", days: null },
];

/** A read-only credential that never expires can only ever disclose; one that can create rows
 *  cannot be left unbounded, because revocation only helps once the leak is noticed. Mirrored by
 *  the API, which rejects the same combinations regardless of what the form allows. */
const MAX_WRITE_EXPIRY_DAYS = 90;

/**
 * What the token represents, stamped onto every transaction it writes.
 *
 * Provenance follows the credential rather than the endpoint: every remote write arrives through
 * `/api/mcp`, so a bot's rows would otherwise be labelled "Added by Claude". `APP` is not offered,
 * because it means the web app itself, which never carries a token.
 */
const SOURCE_OPTIONS: { value: McpTokenSource; label: string; hint: string }[] = [
  { value: "MCP", label: "AI assistant", hint: "Claude Desktop, Claude Code, or another MCP client" },
  { value: "TELEGRAM", label: "Telegram bot", hint: "The personal bot that relays messages to this app" },
];

const allowedExpiry = (days: number | null, write: boolean) =>
  !write || (days !== null && days <= MAX_WRITE_EXPIRY_DAYS);

interface McpTokenCreateProps {
  /** Resolves to whether the token was minted; a rejected save must leave the form intact. */
  onCreate: (input: {
    name: string;
    scopes: McpScope[];
    expiresInDays: number | null;
    source: McpTokenSource;
  }) => Promise<boolean>;
  creating: boolean;
}

export function McpTokenCreate({ onCreate, creating }: McpTokenCreateProps) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpScope[]>([...DEFAULT_MINT_SCOPES]);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(90);
  const [source, setSource] = useState<McpTokenSource>("MCP");

  const write = grantsWrite(scopes);

  const toggleScope = (scope: McpScope) => {
    const next = scopes.includes(scope)
      ? scopes.filter((s) => s !== scope)
      : [...scopes, scope];

    // Ticking a write scope while "Never" or "1 year" is selected would leave the form in a state
    // the API rejects, so pull the selection back to the write ceiling instead of failing on
    // submit. Computed here rather than inside a setState updater: React may run an updater more
    // than once, so queueing a second update from inside one can repeat or observe stale state.
    if (grantsWrite(next) && !allowedExpiry(expiresInDays, true)) {
      setExpiresInDays(MAX_WRITE_EXPIRY_DAYS);
    }
    setScopes(next);
  };

  const canSubmit =
    name.trim().length > 0 &&
    scopes.length > 0 &&
    allowedExpiry(expiresInDays, write) &&
    !creating;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const created = await onCreate({ name: name.trim(), scopes, expiresInDays, source });
    // Only on success: clearing after a transient failure would make the user retype the name
    // just to retry.
    if (created) setName("");
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 rounded-xl border border-cream-300 space-y-4">
      <div>
        <label htmlFor="mcp-token-name" className="text-sm font-medium text-warm-600">
          Token name
        </label>
        <input
          id="mcp-token-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder="Claude Desktop (laptop)"
          className={cn(INPUT_CLASS, "mt-1.5")}
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-warm-600">What it can do</legend>
        <div className="mt-1.5 space-y-2">
          {MCP_SCOPES.map((scope) => (
            <label key={scope} className="flex items-start gap-2.5 text-xs text-warm-500">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
                className="mt-0.5 accent-amber"
              />
              <span>
                <span
                  className={cn(
                    "font-mono",
                    isWriteScope(scope) ? "text-amber-dark font-semibold" : "text-warm-600"
                  )}
                >
                  {scope}
                </span>
                <span className="block text-warm-400">{MCP_SCOPE_LABELS[scope]}</span>
              </span>
            </label>
          ))}
        </div>
        {scopes.length === 0 && (
          <p className="text-xs text-red-600 mt-2">Pick at least one thing it can do.</p>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-warm-600">Used by</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {SOURCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              onClick={() => setSource(option.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                source === option.value
                  ? "bg-amber text-white border-amber"
                  : "border-cream-300 text-warm-500 hover:bg-cream-100"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-warm-400 mt-2">
          {SOURCE_OPTIONS.find((option) => option.value === source)?.hint}. Transactions this token
          creates are tagged with it, so you can tell later where a row came from.
        </p>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-warm-600">Expires</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {EXPIRY_OPTIONS.map((option) => {
            const disabled = !allowedExpiry(option.days, write);
            return (
              <button
                key={option.label}
                type="button"
                disabled={disabled}
                title={disabled ? "Not available for a token that can write" : undefined}
                onClick={() => setExpiresInDays(option.days)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  expiresInDays === option.days && !disabled
                    ? "bg-amber text-white border-amber"
                    : "border-cream-300 text-warm-500 hover:bg-cream-100",
                  disabled && "opacity-40 cursor-not-allowed hover:bg-transparent"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {write && (
          <p className="text-xs text-warm-400 mt-2">
            A token that can write must expire, within {MAX_WRITE_EXPIRY_DAYS} days.
          </p>
        )}
      </fieldset>

      <button type="submit" disabled={!canSubmit} className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed">
        <Plus className="w-4 h-4" />
        {creating ? "Creating…" : "Create token"}
      </button>
    </form>
  );
}
