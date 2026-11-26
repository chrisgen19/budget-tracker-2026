import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRefusedError, refusalFrom } from "@/hooks/api-error";
import { savePreferences } from "@/hooks/use-preferences";
import { updateRoleSetting } from "@/hooks/admin-api";

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("refusalFrom", () => {
  it("uses the server's error string and keeps the status", async () => {
    const error = await refusalFrom(jsonResponse({ error: "Email already in use" }, 409), "fallback");
    expect(error).toBeInstanceOf(ApiRefusedError);
    expect(error.message).toBe("Email already in use");
    expect(error.status).toBe(409);
  });

  it("falls back when the body has no usable error string", async () => {
    expect((await refusalFrom(jsonResponse({ error: "" }, 400), "fallback")).message).toBe("fallback");
    expect((await refusalFrom(jsonResponse({ error: { name: ["bad"] } }, 400), "fallback")).message).toBe(
      "fallback"
    );
    expect((await refusalFrom(new Response("<html>502</html>", { status: 502 }), "fallback")).message).toBe(
      "fallback"
    );
  });
});

/**
 * The distinction three screens word differently: the privacy toggle, every profile switch and
 * the admin settings page say "try again" for a refusal and "check your connection" for a
 * request that never arrived. It only survives the move out of the components if the two reject
 * differently.
 */
describe("request functions keep refusal and network failure apart", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["savePreferences", () => savePreferences({ hideAmounts: true })],
    ["updateRoleSetting", () => updateRoleSetting("FREE", "monthlyScanLimit", 5)],
  ])("%s rejects with ApiRefusedError on a non-2xx", async (_name, call) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 400)));
    await expect(call()).rejects.toBeInstanceOf(ApiRefusedError);
  });

  it.each([
    ["savePreferences", () => savePreferences({ hideAmounts: true })],
    ["updateRoleSetting", () => updateRoleSetting("FREE", "monthlyScanLimit", 5)],
  ])("%s rejects with the network error, not ApiRefusedError, when fetch fails", async (_name, call) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const failure = call();
    await expect(failure).rejects.toBeInstanceOf(TypeError);
    await expect(failure).rejects.not.toBeInstanceOf(ApiRefusedError);
  });

  it("savePreferences resolves on 2xx without needing a readable body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(savePreferences({ hideAmounts: false })).resolves.toBeUndefined();
  });
});
