import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Modal } from "@/components/ui/modal";
import { ToastProvider, useToast } from "@/components/ui/toast";

/**
 * Toasts have to sit above the modal layer, and not by document order.
 *
 * The container renders inside the provider, before the page it wraps, while a Modal
 * portals to the end of `document.body` — so at an equal z-index the later element
 * wins and the modal's backdrop (`bg-warm-900/30 backdrop-blur-sm`) would blur the
 * message behind it. A save failing while a form is open is exactly when that message
 * matters most, which is the rule AGENTS.md states as "a failed save has to say so".
 */
const zIndexOf = (element: Element | null) => {
  const match = element?.className.match(/z-\[?(\d+)\]?/);
  return match ? Number(match[1]) : null;
};

function Raise() {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast("Could not save", "error")}>
      Save
    </button>
  );
}

describe("toast stacking against a modal", () => {
  it("owns a higher layer than the modal overlay", () => {
    const { container } = render(
      <ToastProvider>
        <Modal open onClose={() => {}} title="Review">
          <Raise />
        </Modal>
      </ToastProvider>,
    );

    // The provider's own container, which stays in the React tree it rendered in.
    const toastLayer = container.querySelector("div[class*='fixed'][class*='top-4']");
    const overlay = screen.getByRole("dialog").parentElement;

    expect(zIndexOf(toastLayer)).toBeGreaterThan(zIndexOf(overlay)!);
  });

  it("renders the toast before the modal in the document, which is why the z-index matters", () => {
    // If this order ever flips, equal z-indexes would be fine and the explicit layer
    // would look arbitrary. Pinning it keeps the reason for z-[60] discoverable.
    render(
      <ToastProvider>
        <Modal open onClose={() => {}} title="Review">
          <Raise />
        </Modal>
      </ToastProvider>,
    );

    const dialog = screen.getByRole("dialog");
    const toastLayer = document.querySelector("div[class*='fixed'][class*='top-4']")!;
    const order = toastLayer.compareDocumentPosition(dialog);

    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
