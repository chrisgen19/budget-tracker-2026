import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReturnBar } from "@/components/transactions/return-bar";

describe("ReturnBar", () => {
  it("carries its destination as the accessible name, not as drawn text", () => {
    render(<ReturnBar href="/analytics?period=monthly" label="Analytics" />);

    const link = screen.getByRole("link", { name: "Back to Analytics" });
    expect(link.getAttribute("href")).toBe("/analytics?period=monthly");
    expect(link.textContent).toBe("");
  });

  it("names no period, which is the redundancy it was shedding", () => {
    // The period it used to show was the analytics span, which a drill-down
    // deliberately does not share with the ledger's own filter — so it could name
    // a month the list was not showing.
    render(<ReturnBar href="/analytics?period=monthly&from=2026-09-01" label="Analytics" />);
    expect(screen.getByRole("link", { name: "Back to Analytics" }).textContent).not.toContain("2026");
  });

  it("keeps a 44px target under a 36px button, having no interactive neighbour", () => {
    render(<ReturnBar href="/analytics" label="Analytics" />);
    const link = screen.getByRole("link", { name: "Back to Analytics" });

    expect(link.className).toContain("before:h-11");
    expect(link.className).toContain("before:w-11");
  });

  it("is a link, so it works on a cold PWA start with no history", () => {
    // router.back() has nothing to go back to when the installed app is opened
    // directly on this URL, which is the case this exists for.
    render(<ReturnBar href="/analytics?period=monthly" label="Analytics" />);
    expect(screen.getByRole("link", { name: "Back to Analytics" }).tagName).toBe("A");
  });
});
