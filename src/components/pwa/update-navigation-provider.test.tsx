import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IsBusy } from "@/hooks/use-service-worker-update";
import { UpdateNavigationProvider, useUpdateNavigation } from "./update-navigation-provider";

const applyOnNavigation = vi.fn();
const push = vi.fn();

/** What the provider handed the hook on its last render, for the busy re-check. */
let isBusy: IsBusy | undefined;

vi.mock("@/hooks/use-service-worker-update", () => ({
  useServiceWorkerUpdate: (given?: IsBusy) => {
    isBusy = given;
    return {
      status: "waiting",
      updateAvailable: true,
      applyUpdate: vi.fn(),
      applyOnNavigation: (href: string) => applyOnNavigation(href),
    };
  },
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

function ShowAvailability() {
  const { updateAvailable } = useUpdateNavigation();
  return <span data-testid="available">{updateAvailable ? "yes" : "no"}</span>;
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

  // The hand-off can finish up to 3s after the tap, so the hook asks again then. A scan started in
  // between must still be seen by a check the provider handed over at mount.
  it("hands the hook a busy check that tracks the prop", () => {
    const { rerender } = renderShell(false);
    expect(isBusy?.()).toBe(false);

    rerender(
      <UpdateNavigationProvider busy>
        <a href="/bills">Bills</a>
        <GoToGoals />
      </UpdateNavigationProvider>,
    );
    expect(isBusy?.()).toBe(true);
  });

  // `applyUpdate` for a stale tab is an unguarded reload and the banner is its only caller, so
  // hiding the banner is what keeps a tap on it from destroying the queue.
  it("reports no update available while a scan is busy", () => {
    render(
      <UpdateNavigationProvider busy>
        <ShowAvailability />
      </UpdateNavigationProvider>,
    );
    expect(screen.getByTestId("available").textContent).toBe("no");
  });

  it("reports the update again once nothing is busy", () => {
    render(
      <UpdateNavigationProvider busy={false}>
        <ShowAvailability />
      </UpdateNavigationProvider>,
    );
    expect(screen.getByTestId("available").textContent).toBe("yes");
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
