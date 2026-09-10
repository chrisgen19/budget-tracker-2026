import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/ui/modal";

/**
 * The body scroll lock is ref-counted across every mounted Modal.
 *
 * Before that, each instance snapshotted and restored `document.body.style.overflow`
 * itself. A ConfirmModal opening over an already-open modal captured the outer one's
 * "hidden", and closing both in the same commit ran the cleanups in tree order: the outer
 * restored the real value, then the inner restored "hidden" over it. The page could not be
 * scrolled again until a reload.
 */
describe("Modal body scroll lock", () => {
  it("locks while open and restores on close", () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Review">
        <p>body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <Modal open={false} onClose={() => {}} title="Review">
        <p>body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the lock while a nested modal is still open", () => {
    function Stack({ outer, inner }: { outer: boolean; inner: boolean }) {
      return (
        <>
          <Modal open={outer} onClose={() => {}} title="Review">
            <p>review</p>
          </Modal>
          <Modal open={inner} onClose={() => {}} title="Discard?">
            <p>confirm</p>
          </Modal>
        </>
      );
    }

    const { rerender } = render(<Stack outer inner={false} />);
    expect(document.body.style.overflow).toBe("hidden");

    // Confirmation opens on top of the review.
    rerender(<Stack outer inner />);
    expect(document.body.style.overflow).toBe("hidden");

    // Only the confirmation closes — the review is still open and still needs the lock.
    rerender(<Stack outer inner={false} />);
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<Stack outer={false} inner={false} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("restores the page scroll when both modals close in the same commit", () => {
    function Stack({ open }: { open: boolean }) {
      return (
        <>
          <Modal open={open} onClose={() => {}} title="Review">
            <p>review</p>
          </Modal>
          <Modal open={open} onClose={() => {}} title="Discard?">
            <p>confirm</p>
          </Modal>
        </>
      );
    }

    const { rerender } = render(<Stack open />);
    expect(document.body.style.overflow).toBe("hidden");

    // Confirming a discard closes the confirmation and the review together. Per-instance
    // snapshots left "hidden" here, silently breaking scrolling for the whole app.
    rerender(<Stack open={false} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("restores an overflow value the page had set before any modal opened", () => {
    document.body.style.overflow = "clip";

    const { rerender } = render(
      <Modal open onClose={() => {}} title="Review">
        <p>body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <Modal open={false} onClose={() => {}} title="Review">
        <p>body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("clip");

    document.body.style.overflow = "";
  });

  it("cycles keyboard focus within the topmost modal", () => {
    render(
      <Modal open onClose={() => {}} title="Review">
        <button type="button">Cancel</button>
        <button type="button">Save</button>
      </Modal>,
    );
    const close = screen.getByRole("button", { name: "Close Review" });
    const save = screen.getByRole("button", { name: "Save" });

    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it("lets only the topmost modal handle Escape", () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(
      <>
        <Modal open onClose={closeOuter} title="Review"><button>Outer action</button></Modal>
        <Modal open onClose={closeInner} title="Discard?"><button>Inner action</button></Modal>
      </>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(closeInner).toHaveBeenCalledOnce();
    expect(closeOuter).not.toHaveBeenCalled();
  });
});

/**
 * `fixed inset-0` reads as immune to an ancestor and is not: any ancestor with a
 * transform becomes the containing block for `position: fixed` descendants, so the
 * overlay resolves against that box instead of the viewport — and an
 * `overflow-hidden` on the way up then clips the dialog out of sight.
 *
 * jsdom computes no layout, so these assert the DOM position that makes the CSS
 * moot rather than the measurements themselves. That is the property the fix
 * actually establishes; the measurements were taken in a browser (#286).
 */
describe("Modal escapes a clipping, transformed ancestor", () => {
  /** The transactions toolbar: `overflow-hidden`, and transformed even at rest. */
  const Hazard = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hazard" style={{ overflow: "hidden", transform: "translateY(0)" }}>
      {children}
    </div>
  );

  it("renders outside the ancestor that would clip it", () => {
    const { container } = render(
      <Hazard>
        <Modal open onClose={() => {}} title="Choose period">
          <p>panel</p>
        </Modal>
      </Hazard>,
    );

    const dialog = screen.getByRole("dialog");
    expect(screen.getByTestId("hazard").contains(dialog)).toBe(false);
    // And not merely out of that div — out of the render container entirely.
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("still reaches the caller's handlers, because portals bubble in the React tree", () => {
    // The reason this is safe to do for every caller at once: moving the DOM node does
    // not move the event path React uses, so an onClick on a JSX ancestor still fires.
    const onAncestorClick = vi.fn();
    render(
      <div onClick={onAncestorClick}>
        <Hazard>
          <Modal open onClose={() => {}} title="Review">
            <button type="button">Save</button>
          </Modal>
        </Hazard>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onAncestorClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the focus trap working from its new position", () => {
    // The trap queries inside the dialog ref, so it does not care where the dialog
    // lives — but it is the thing that would break most quietly if it did.
    render(
      <Hazard>
        <Modal open onClose={() => {}} title="Review">
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>
      </Hazard>,
    );

    // The header's close button is the dialog's first focusable, ahead of any content,
    // so it is where a forward wrap lands.
    const close = screen.getByRole("button", { name: "Close Review" });
    const last = screen.getByRole("button", { name: "Last" });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes on Escape from its new position", () => {
    const onClose = vi.fn();
    render(
      <Hazard>
        <Modal open onClose={onClose} title="Review">
          <p>body</p>
        </Modal>
      </Hazard>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
