import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileMenu } from "./profile-menu";

const navigate = vi.fn();
const push = vi.fn();

vi.mock("@/components/pwa/update-navigation-provider", () => ({
  useUpdateNavigation: () => ({ navigate: (href: string) => navigate(href) }),
}));
vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => ({ hideAmounts: false, toggleHideAmounts: vi.fn() }),
}));
vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { creditCardsEnabled: false } }),
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileMenu", () => {
  // Menu items are `router.push` calls rather than links, so the update-on-navigation click
  // listener never sees them. Routing them through `navigate` is what lets them take an update.
  it("sends menu items through the update-aware navigate", () => {
    render(<ProfileMenu variant="desktop" name="A" email="a@test" isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "My Profile" }));
    expect(navigate).toHaveBeenCalledWith("/profile");
    expect(push).not.toHaveBeenCalled();
  });
});
