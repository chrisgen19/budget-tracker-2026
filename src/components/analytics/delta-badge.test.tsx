import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeltaBadge } from "./delta-badge";

describe("DeltaBadge", () => {
  it("does not publish a percentage when the coverage gate rejects the comparison", () => {
    render(<DeltaBadge current={100} previous={50} available={false} />);

    expect(screen.getByLabelText("Comparison unavailable")).toBeTruthy();
    expect(screen.queryByText("+100%")).toBeNull();
  });
});
