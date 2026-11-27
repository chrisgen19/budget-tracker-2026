import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachPhotoField } from "@/components/transactions/attach-photo-field";

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

describe("AttachPhotoField", () => {
  it("offers an Attach photo button with a 44px hit area when there is no photo", () => {
    render(<AttachPhotoField hasPhoto={false} onSelect={() => {}} onRemove={() => {}} />);

    const button = screen.getByRole("button", { name: "Attach photo" });
    expect(button.className).toContain("min-h-11");
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
  });

  // No `capture`: a receipt is as often a saved screenshot or gallery photo as a fresh shot.
  it("takes any image from the library or camera, without forcing the camera", () => {
    render(<AttachPhotoField hasPhoto={false} onSelect={() => {}} onRemove={() => {}} />);

    expect(fileInput().getAttribute("accept")).toBe("image/*");
    expect(fileInput().hasAttribute("capture")).toBe(false);
  });

  it("hands the chosen file to onSelect", () => {
    const onSelect = vi.fn();
    render(<AttachPhotoField hasPhoto={false} onSelect={onSelect} onRemove={() => {}} />);
    const file = new File(["x"], "receipt.jpg", { type: "image/jpeg" });

    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it("offers Replace and Remove once a photo is shown", () => {
    const onRemove = vi.fn();
    render(<AttachPhotoField hasPhoto onSelect={() => {}} onRemove={onRemove} />);

    expect(screen.queryByRole("button", { name: "Attach photo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Replace photo" }).className).toContain("min-h-11");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
