import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePromptBanner } from "./update-prompt-banner";

const applyUpdate = vi.fn();
const swUpdate = vi.fn();
const onlineStatus = vi.fn();

vi.mock("@/components/pwa/update-navigation-provider", () => ({
  useUpdateNavigation: () => swUpdate(),
}));
vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => onlineStatus(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  swUpdate.mockReturnValue({ status: "waiting", updateAvailable: true, applyUpdate });
  onlineStatus.mockReturnValue(true);
});

describe("UpdatePromptBanner", () => {
  it("offers a reload when a new build is waiting", () => {
    render(<UpdatePromptBanner />);
    expect(screen.getByRole("status").textContent).toContain("A new version is available.");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  // A tab whose worker another tab swapped: no waiting worker, but still the old bundle.
  it("offers a reload to a stale tab too", () => {
    swUpdate.mockReturnValue({ status: "stale", updateAvailable: true, applyUpdate });
    render(<UpdatePromptBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when there is no update", () => {
    swUpdate.mockReturnValue({ status: "none", updateAvailable: false, applyUpdate });
    render(<UpdatePromptBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // It shares its offsets with OfflineBanner, so both showing at once is an overlap rather than a
  // stack. The waiting worker keeps waiting, and the prompt returns with the connection.
  it("stays out of the way while offline, where OfflineBanner sits", () => {
    onlineStatus.mockReturnValue(false);
    render(<UpdatePromptBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
