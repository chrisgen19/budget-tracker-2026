import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { McpTokenList, type McpTokenRecord } from "@/components/profile/mcp-token-list";

const token = (over: Partial<McpTokenRecord> = {}): McpTokenRecord => ({
  id: "tok_1",
  name: "Claude Desktop",
  prefix: "btmcp_abc",
  scopes: ["budget:read"],
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

const revoked = (over: Partial<McpTokenRecord> = {}) =>
  token({ id: "tok_dead", name: "Old token", revokedAt: "2026-08-10T00:00:00.000Z", ...over });

const renderList = (tokens: McpTokenRecord[]) => {
  const onRevoke = vi.fn();
  const onDelete = vi.fn();
  const onChangeExpiry = vi.fn().mockResolvedValue(true);
  render(
    <McpTokenList
      tokens={tokens}
      revokingId={null}
      deletingId={null}
      onRevoke={onRevoke}
      onDelete={onDelete}
      changingExpiryId={null}
      onChangeExpiry={onChangeExpiry}
    />
  );
  return { onRevoke, onDelete, onChangeExpiry };
};

const writeScopes = ["budget:read", "transactions:write"];

describe("McpTokenList", () => {
  it("lists a live token with a revoke action", () => {
    const { onRevoke } = renderList([token()]);

    expect(screen.getByText("Claude Desktop")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));
    expect(onRevoke).toHaveBeenCalled();
  });

  // The complaint this fixes: revoked tokens stayed in the list forever, so after a few
  // rotations the working ones were buried under credentials that cannot be used.
  it("keeps revoked tokens out of the list until asked", () => {
    renderList([token(), revoked()]);

    expect(screen.getByText("Claude Desktop")).toBeDefined();
    expect(screen.queryByText("Old token")).toBeNull();
    expect(screen.getByRole("button", { name: /1 revoked or expired/i })).toBeDefined();
  });

  it("shows them when asked, with a delete action", () => {
    const { onDelete } = renderList([token(), revoked()]);

    fireEvent.click(screen.getByRole("button", { name: /1 revoked or expired/i }));
    expect(screen.getByText("Old token")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "tok_dead" }));
  });

  it("counts expired tokens as dead too, not just revoked ones", () => {
    renderList([token(), token({ id: "tok_exp", name: "Expired token", expiresAt: "2020-01-01T00:00:00.000Z" })]);

    expect(screen.queryByText("Expired token")).toBeNull();
    expect(screen.getByRole("button", { name: /1 revoked or expired/i })).toBeDefined();
  });

  // Deleting is offered only where the API accepts it, so the UI cannot invite a 409.
  it("offers revoke on live tokens and delete on dead ones, never both", () => {
    renderList([token()]);

    expect(screen.getByRole("button", { name: /revoke/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("says what deleting costs, since it is not reversible", () => {
    renderList([revoked()]);
    fireEvent.click(screen.getByRole("button", { name: /1 revoked or expired/i }));

    expect(screen.getByText(/transactions it created stay exactly as they are/i)).toBeDefined();
  });

  it("tells a user with only dead tokens that none are in use", () => {
    renderList([revoked()]);
    expect(screen.getByText(/No tokens in use/i)).toBeDefined();
  });

  it("shows the empty state when there are no tokens at all", () => {
    renderList([]);
    expect(screen.getByText(/No tokens yet/i)).toBeDefined();
  });

  describe("Change expiry", () => {
    const optionNames = () =>
      screen
        .getAllByRole("button")
        .map((button) => button.textContent ?? "")
        .filter((text) => /days|year|Never/.test(text));

    it("offers the bot's write token Never and a year", () => {
      renderList([token({ scopes: writeScopes, source: "TELEGRAM" })]);
      fireEvent.click(screen.getByRole("button", { name: /change expiry/i }));

      expect(optionNames()).toEqual(["30 days", "90 days", "1 year", "Never expires"]);
    });

    // The same rule the API applies, so the list never offers a button the server refuses.
    it("offers an assistant's write token nothing past 90 days", () => {
      renderList([token({ scopes: writeScopes, source: "MCP" })]);
      fireEvent.click(screen.getByRole("button", { name: /change expiry/i }));

      expect(optionNames()).toEqual(["30 days", "90 days"]);
    });

    it("sends Never as null and closes once saved", async () => {
      const bot = token({ scopes: writeScopes, source: "TELEGRAM" });
      const { onChangeExpiry } = renderList([bot]);
      fireEvent.click(screen.getByRole("button", { name: /change expiry/i }));
      fireEvent.click(screen.getByRole("button", { name: "Never expires" }));

      expect(onChangeExpiry).toHaveBeenCalledWith(bot, null);
      await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Never expires" })).toBeNull());
    });

    it("stays open when the save is refused, so the choice can be retried", async () => {
      const { onChangeExpiry } = renderList([token({ scopes: writeScopes, source: "TELEGRAM" })]);
      onChangeExpiry.mockResolvedValue(false);
      fireEvent.click(screen.getByRole("button", { name: /change expiry/i }));
      fireEvent.click(screen.getByRole("button", { name: "Never expires" }));

      await vi.waitFor(() => expect(onChangeExpiry).toHaveBeenCalled());
      expect(screen.getByRole("button", { name: "Never expires" })).toBeDefined();
    });

    it("is not offered on a dead token", () => {
      renderList([revoked()]);
      fireEvent.click(screen.getByRole("button", { name: /revoked or expired/i }));

      expect(screen.queryByRole("button", { name: /change expiry/i })).toBeNull();
    });
  });
});
