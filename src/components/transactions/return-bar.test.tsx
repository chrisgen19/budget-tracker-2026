import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReturnBar } from "@/components/transactions/return-bar";

describe("ReturnBar", () => {
  it("names where it goes and the view it returns to", () => {
    render(<ReturnBar href="/analytics?period=monthly" label="Analytics" context="Sep 1 – 30" />);

    const link = screen.getByRole("link", { name: /Analytics/ });
    expect(link.getAttribute("href")).toBe("/analytics?period=monthly");
    expect(link.textContent).toContain("Sep 1 – 30");
  });

  it("still reads as a way back with no context to show", () => {
    render(<ReturnBar href="/analytics" label="Analytics" />);
    expect(screen.getByRole("link", { name: "Analytics" })).toBeTruthy();
  });

  it("is a link, so it works on a cold PWA start with no history", () => {
    // router.back() has nothing to go back to when the installed app is opened
    // directly on this URL, which is the case this exists for.
    render(<ReturnBar href="/analytics?period=monthly" label="Analytics" />);
    expect(screen.getByRole("link", { name: "Analytics" }).tagName).toBe("A");
  });
});
