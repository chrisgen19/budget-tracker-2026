"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MCP_SCOPES, MCP_SCOPE_LABELS, type McpScope } from "@/lib/mcp/scopes";

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

interface McpTokenCreateProps {
  /** Resolves to whether the token was minted; a rejected save must leave the form intact. */
  onCreate: (input: { name: string; scopes: McpScope[]; expiresInDays: number | null }) => Promise<boolean>;
  creating: boolean;
}

export function McpTokenCreate({ onCreate, creating }: McpTokenCreateProps) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpScope[]>([...MCP_SCOPES]);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(90);

  const toggleScope = (scope: McpScope) =>
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]
    );

  const canSubmit = name.trim().length > 0 && scopes.length > 0 && !creating;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const created = await onCreate({ name: name.trim(), scopes, expiresInDays });
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
        <legend className="text-sm font-medium text-warm-600">What it can read</legend>
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
                <span className="font-mono text-warm-600">{scope}</span>
                <span className="block text-warm-400">{MCP_SCOPE_LABELS[scope]}</span>
              </span>
            </label>
          ))}
        </div>
        {scopes.length === 0 && (
          <p className="text-xs text-red-600 mt-2">Pick at least one thing it can read.</p>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-warm-600">Expires</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {EXPIRY_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setExpiresInDays(option.days)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                expiresInDays === option.days
                  ? "bg-amber text-white border-amber"
                  : "border-cream-300 text-warm-500 hover:bg-cream-100"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <button type="submit" disabled={!canSubmit} className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed">
        <Plus className="w-4 h-4" />
        {creating ? "Creating…" : "Create token"}
      </button>
    </form>
  );
}
