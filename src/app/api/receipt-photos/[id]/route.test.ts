import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  enabled: vi.fn(),
  get: vi.fn(),
  findFirst: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    receiptPhoto: { findFirst: mocks.findFirst },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock("@/lib/receipt-photo-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/receipt-photo-storage")>()),
  receiptPhotosEnabled: mocks.enabled,
  createPhotoStorage: () => ({ put: vi.fn(), get: mocks.get, delete: vi.fn() }),
}));

import { GET } from "@/app/api/receipt-photos/[id]/route";
import { GET as GET_INFO } from "@/app/api/receipt-photos/[id]/info/route";
import { PhotoNotFoundError } from "@/lib/receipt-photo-storage";

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost/api/receipt-photos/p1");

describe("GET /api/receipt-photos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.enabled.mockReturnValue(true);
  });

  it("404 for another user's photo, scoped by userId", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const res = await GET(req(), context("p1"));
    expect(res.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", userId: "user-1" } }));
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("streams own photo as private jpeg", async () => {
    mocks.findFirst.mockResolvedValue({ objectKey: "receipts/user-1/p1.jpg" });
    mocks.get.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const res = await GET(req(), context("p1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith("receipts/user-1/p1.jpg");
  });

  it("404 when the object is missing from storage", async () => {
    mocks.findFirst.mockResolvedValue({ objectKey: "k" });
    mocks.get.mockRejectedValue(new PhotoNotFoundError("k"));
    expect((await GET(req(), context("p1"))).status).toBe(404);
  });

  it("503 when photos are disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await GET(req(), context("p1"))).status).toBe(503);
  });
});

describe("GET /api/receipt-photos/[id]/info", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
  });

  it("404 for another user's photo", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await GET_INFO(req(), context("p1"))).status).toBe(404);
  });

  it("returns info for own photo", async () => {
    mocks.userFindUnique.mockResolvedValue({ timezoneOffset: 0 });
    mocks.findFirst.mockResolvedValue({
      id: "p1", width: 1, height: 1, byteSize: 1, createdAt: new Date("2026-01-01T00:00:00Z"), transactions: [],
    });
    const res = await GET_INFO(req(), context("p1"));
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(0);
  });
});
