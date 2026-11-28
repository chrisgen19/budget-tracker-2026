import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransactionLabelPills } from "@/components/transactions/transaction-label-pills";
import type { Label, TransactionLabel } from "@/types";

/**
 * Phone vs desktop is decided in CSS, so these assert the classes that decide it. On a 390px
 * phone the pills used to be `shrink-0`, which squeezed the category beside them down to a lone
 * "·" and then had the row's `overflow-hidden` cut the pill itself mid-word.
 */

const makeLabels = (names: string[]) =>
  names.map(
    (name, i) =>
      ({
        id: `tl_${i}`,
        labelId: `l_${i}`,
        label: { id: `l_${i}`, name, color: "#D9643A" },
      }) as unknown as TransactionLabel & { label: Label },
  );

describe("TransactionLabelPills", () => {
  it("renders nothing, not even the separator, without labels", () => {
    const { container } = render(<TransactionLabelPills labels={[]} maxVisible={3} />);
    expect(container.textContent).toBe("");
  });

  it("lets the first pill shrink and truncate its name on phones", () => {
    render(<TransactionLabelPills labels={makeLabels(["With Mom and Dad Budget"])} collapseOnPhone />);
    const name = screen.getByText("With Mom and Dad Budget");
    expect(name.className).toContain("truncate");
    const pill = name.parentElement!;
    expect(pill.className).toContain("max-w-[55%]");
    expect(pill.className).toContain("sm:shrink-0");
  });

  it("shows only the first pill on phones and counts the rest", () => {
    render(
      <TransactionLabelPills
        labels={makeLabels(["Work", "Personal", "Family"])}
        maxVisible={3}
        collapseOnPhone
      />,
    );
    expect(screen.getByText("Work").parentElement!.className).not.toContain("hidden");
    expect(screen.getByText("Personal").parentElement!.className).toContain("hidden sm:inline-flex");
    expect(screen.getByText("Family").parentElement!.className).toContain("hidden sm:inline-flex");
    expect(screen.getByText("+2").className).toContain("sm:hidden");
  });

  it("leaves the layout alone for callers that do not opt in", () => {
    render(<TransactionLabelPills labels={makeLabels(["Work", "Personal"])} maxVisible={3} />);
    expect(screen.getByText("Personal").parentElement!.className).not.toContain("hidden");
    expect(screen.getByText("Work").parentElement!.className).toContain("shrink-0");
  });

  it("keeps a separate desktop overflow count past maxVisible", () => {
    render(
      <TransactionLabelPills
        labels={makeLabels(["Work", "Personal", "Family", "Trip"])}
        maxVisible={3}
        collapseOnPhone
      />,
    );
    expect(screen.getByText("+3").className).toContain("sm:hidden");
    expect(screen.getByText("+1").className).toContain("hidden sm:inline");
  });
});
