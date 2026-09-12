import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/ui/page-header";

describe("PageHeader", () => {
  it("renders the title as the page's level-one heading", () => {
    render(<PageHeader title="Transactions" />);
    expect(screen.getByRole("heading", { level: 1, name: "Transactions" })).toBeTruthy();
  });

  it("keeps meta at every width but hides the static description below sm", () => {
    render(<PageHeader title="Transactions" meta="15 of 28 loaded" description="A ledger." />);
    expect(screen.getByText("15 of 28 loaded").classList.contains("hidden")).toBe(false);
    // `hidden sm:block` is the whole point: the copy never changes, so on a phone it
    // would spend a line saying nothing the title did not.
    const description = screen.getByText("A ledger.");
    expect(description.classList.contains("hidden")).toBe(true);
    expect(description.classList.contains("sm:block")).toBe(true);
  });

  it("only makes the heading a focus target when asked", () => {
    const { rerender } = render(<PageHeader title="Bills" />);
    expect(screen.getByRole("heading", { level: 1 }).getAttribute("tabindex")).toBeNull();

    rerender(<PageHeader title="Bills" focusable />);
    expect(screen.getByRole("heading", { level: 1 }).getAttribute("tabindex")).toBe("-1");
  });

  it("exposes the heading through a ref, so a page can move focus to it", () => {
    const ref = createRef<HTMLHeadingElement>();
    render(<PageHeader title="Transactions" headingRef={ref} focusable />);
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it("renders a badge beside the title and an action in either placement", () => {
    const { rerender } = render(
      <PageHeader title="Profile" badge={<span>ADMIN</span>} action={<button>New</button>} />,
    );
    expect(screen.getByText("ADMIN")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();

    rerender(
      <PageHeader title="Analytics" actionPlacement="below" action={<button>Period</button>} />,
    );
    expect(screen.getByRole("button", { name: "Period" })).toBeTruthy();
  });
});
