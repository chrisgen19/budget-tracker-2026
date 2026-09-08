import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrivacyToggle } from "@/components/privacy-toggle";

const mocks = vi.hoisted(() => ({ hideAmounts: false, toggleHideAmounts: vi.fn() }));
vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => ({
    hideAmounts: mocks.hideAmounts,
    toggleHideAmounts: mocks.toggleHideAmounts,
  }),
}));

beforeEach(() => {
  mocks.hideAmounts = false;
  mocks.toggleHideAmounts.mockClear();
});

describe("the icon toggle", () => {
  /** The state belongs on `aria-pressed`, not in a name that swaps under the user mid-focus. */
  it("names the control and reports the state separately", () => {
    const { rerender } = render(<PrivacyToggle variant="icon" />);

    const button = screen.getByRole("button", { name: "Hide amounts" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("title")).toBe("Hide amounts");

    mocks.hideAmounts = true;
    rerender(<PrivacyToggle variant="icon" />);

    const pressed = screen.getByRole("button", { name: "Hide amounts" });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(pressed.getAttribute("title")).toBe("Show amounts");
  });

  it("toggles once per press", () => {
    render(<PrivacyToggle variant="icon" />);

    fireEvent.click(screen.getByRole("button", { name: "Hide amounts" }));

    expect(mocks.toggleHideAmounts).toHaveBeenCalledTimes(1);
  });
});

describe("the sidebar row toggle", () => {
  it("exposes a switch carrying the current state", () => {
    const { rerender } = render(<PrivacyToggle variant="row" />);

    expect(screen.getByRole("switch", { name: "Hide amounts" }).getAttribute("aria-checked")).toBe(
      "false"
    );

    mocks.hideAmounts = true;
    rerender(<PrivacyToggle variant="row" />);

    expect(screen.getByRole("switch", { name: "Hide amounts" }).getAttribute("aria-checked")).toBe(
      "true"
    );
  });

  it("toggles once per press", () => {
    render(<PrivacyToggle variant="row" />);

    fireEvent.click(screen.getByRole("switch", { name: "Hide amounts" }));

    expect(mocks.toggleHideAmounts).toHaveBeenCalledTimes(1);
  });
});
