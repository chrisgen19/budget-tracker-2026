import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNavigationProvider, useUpdateNavigation } from "./update-navigation-provider";

const applyOnNavigation = vi.fn();
const push = vi.fn();

vi.mock("@/hooks/use-service-worker-update", () => ({
  useServiceWorkerUpdate: () => ({
    status: "waiting",
    updateAvailable: true,
    applyUpdate: vi.fn(),
    applyOnNavigation: (href: string) => applyOnNavigation(href),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function GoToGoals() {
  const { navigate } = useUpdateNavigation();
  return (
    <button type="button" onClick={() => navigate("/goals")}>
      Goals
    </button>
  );
}

const renderShell = (busy = false) =>
  render(
    <UpdateNavigationProvider busy={busy}>
      <a href="/bills">Bills</a>
      <GoToGoals />
    </UpdateNavigationProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  applyOnNavigation.mockReturnValue(true);
});

describe("UpdateNavigationProvider", () => {
  it("hands a plain link tap to the update and cancels the client navigation", () => {
    renderShell();
    const proceeded = fireEvent.click(screen.getByRole("link", { name: "Bills" }));
    expect(proceeded).toBe(false);
    expect(applyOnNavigation).toHaveBeenCalledWith("/bills");
  });

  it("leaves the link alone when the update declines", () => {
    applyOnNavigation.mockReturnValue(false);
    renderShell();
    expect(fireEvent.click(screen.getByRole("link", { name: "Bills" }))).toBe(true);
  });

  it("leaves the link alone while a scan is busy", () => {
    renderShell(true);
    expect(fireEvent.click(screen.getByRole("link", { name: "Bills" }))).toBe(true);
    expect(applyOnNavigation).not.toHaveBeenCalled();
  });

  it("reads busy as it changes", () => {
    const { rerender } = renderShell(true);
    rerender(
      <UpdateNavigationProvider busy={false}>
        <a href="/bills">Bills</a>
        <GoToGoals />
      </UpdateNavigationProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Bills" }));
    expect(applyOnNavigation).toHaveBeenCalledWith("/bills");
  });

  it("routes navigate through the update, falling back to router.push", () => {
    const { unmount } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Goals" }));
    expect(applyOnNavigation).toHaveBeenCalledWith("/goals");
    expect(push).not.toHaveBeenCalled();

    applyOnNavigation.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Goals" }));
    expect(push).toHaveBeenCalledWith("/goals");
    unmount();

    vi.clearAllMocks();
    renderShell(true);
    fireEvent.click(screen.getByRole("button", { name: "Goals" }));
    expect(applyOnNavigation).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/goals");
  });

  it("falls back to router.push without a provider", () => {
    render(<GoToGoals />);
    fireEvent.click(screen.getByRole("button", { name: "Goals" }));
    expect(push).toHaveBeenCalledWith("/goals");
    expect(applyOnNavigation).not.toHaveBeenCalled();
  });

  it("removes the click listener on unmount", () => {
    renderShell().unmount();
    const link = document.createElement("a");
    link.setAttribute("href", "/labels");
    document.body.appendChild(link);
    fireEvent.click(link);
    expect(applyOnNavigation).not.toHaveBeenCalled();
    link.remove();
  });
});
