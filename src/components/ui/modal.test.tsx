import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
