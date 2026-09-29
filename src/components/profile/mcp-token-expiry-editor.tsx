"use client";

import { parseScopes } from "@/lib/mcp/scopes";
import { tokenExpiryRefusal } from "@/lib/validations";
import { TOKEN_EXPIRY_OPTIONS } from "@/components/profile/mcp-token-create";
import { HIT_AREA } from "@/components/profile/mcp-write-access";
import type { McpTokenRecord } from "@/components/profile/mcp-token-list";
import { cn } from "@/lib/utils";

interface McpTokenExpiryEditorProps {
  token: McpTokenRecord;
  saving: boolean;
  onSave: (expiresInDays: number | null) => void;
  onCancel: () => void;
}

/**
 * The lifetimes a live token can be moved to, counted from today.
 *
 * Offers only what `tokenExpiryRefusal` accepts for this token's own scopes and source, the rule
 * `PATCH /api/mcp/tokens/[id]` applies, so an assistant's write token is never shown "Never".
 */
export function McpTokenExpiryEditor({ token, saving, onSave, onCancel }: McpTokenExpiryEditorProps) {
  const scopes = parseScopes(token.scopes);
  const source = token.source ?? "MCP";
  const options = TOKEN_EXPIRY_OPTIONS.filter(
    (option) => tokenExpiryRefusal({ scopes, source, expiresInDays: option.days }) === null
  );

  return (
    <div className="mt-3 pt-3 border-t border-cream-200">
      <p className="text-xs text-warm-500">
        New expiry, counted from today. It replaces the current one; the token itself does not
        change.
      </p>
      {/* Same 30px pill + 14px row gap as the write-access panel, so wrapped hit areas meet. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-3.5">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={saving}
            onClick={() => onSave(option.days)}
            className={cn(
              HIT_AREA,
              "px-3 py-1.5 rounded-full text-xs font-medium border border-cream-300 text-warm-500 hover:bg-cream-100 transition-colors disabled:opacity-50"
            )}
          >
            {option.days === null ? "Never expires" : option.label}
          </button>
        ))}
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className={cn(HIT_AREA, "px-2 py-1.5 text-xs font-medium text-warm-400 hover:text-warm-600")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
