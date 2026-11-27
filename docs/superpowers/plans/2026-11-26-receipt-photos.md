# Receipt Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep receipt photos in Cloudflare R2 and attach them to transactions, from scans and by hand, with the photo shown beside the edit form.

**Architecture:** A `receipt_photos` table plus a nullable `transactions.receipt_photo_id`. Photos travel browser → app → R2 and back through owner-checked routes, re-encoded by `sharp` with metadata stripped. Web flows upload the photo first (unlinked), then create or update transactions carrying `receiptPhotoId`; the Telegram bot attaches after its save through a new MCP tool.

**Tech Stack:** Next.js 15 App Router, Prisma/PostgreSQL, `aws4fetch` 1.0.20 (new, approved), `sharp` (existing), TanStack Query v5, Motion, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-11-26-receipt-photos-design.md`

## Deviation from the spec (needs the owner's OK before Task 4)

The spec says web scans upload the photo **after** the batch save and link it by transaction id.
That cannot be done safely: a replayed batch returns its rows from `findSavedBatch`
(`src/lib/transaction-writes.ts:69`) with no `orderBy`, so a retry could attach one receipt's photo
to another receipt's rows. This plan uploads first and saves rows with `receiptPhotoId` instead.
The spec's guarantee still holds: a failed upload only drops the photo, never the save. Photos
uploaded but never saved are orphans, removed by the prune script (Task 10). The Telegram bot
saves one row per receipt, so it keeps the spec's attach-after-save shape.

Two smaller consequences, for one shape across the web:

- The Add and Edit form also upload first and submit `receiptPhotoId` with the transaction,
  rather than uploading after the create.
- Remove is `receiptPhotoId: null` on the existing `PUT /api/transactions/[id]`, so the spec's
  `DELETE /api/transactions/[id]/receipt-photo` route is not built. Same behaviour: unlinks that
  one row, deletes the photo once nothing references it.

## Global Constraints

- Only new dependency: `aws4fetch@1.0.20`. Install with `pnpm add aws4fetch@1.0.20`.
- Environment: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Any blank or missing means photos are disabled: routes answer **503** `{ code: "PHOTOS_DISABLED" }`, and no attach UI renders.
- Object key: `receipts/{userId}/{photoId}.jpg`. Never a description or amount.
- Stored format: JPEG, quality 80, longest side ≤ `MAX_IMAGE_DIMENSION` (1500), never enlarged, all metadata stripped.
- Upload size: refuse over `MAX_FILE_SIZE` (4 MB, `src/lib/receipt-limits.ts`) with 413.
- Photo routes: 404 (never 403) for another user's photo or transaction. Bytes served with `Cache-Control: private, no-store`.
- Migration is expand-only (new table, nullable column, index). No response field removed.
- Web UI reaches the API only through `src/hooks/` (project convention since #414).
- No `console.log`; scripts under `scripts/` may print. No em or en dashes in copy, comments or commits.
- Toast copy on a failed upload: `Saved. The photo didn't upload: attach it from the transaction.`
- Run `pnpm lint`, `pnpm type-check`, `pnpm test` and `cd mcp-server && pnpm type-check` before each commit that touches `src/lib/mcp/**` or `budget-queries`.

## Review Focus

1. **A retried batch save with photos** (lost response, Save pressed again): every receipt's rows end up with their own photo, and no photo is stored twice. Pinned in Task 9.
2. **R2 down or the upload refused mid-save**: transactions still save, with the toast above. Pinned in Task 9 (scan) and Task 7 (form).
3. **A `receiptPhotoId` that belongs to someone else** sent on create, batch create or update: refused, nothing linked. Pinned in Task 5.
4. **A non-image, oversized or corrupt upload** (a PDF, an 8 MB file, truncated JPEG bytes): 415/413/422, never a 500, nothing written to R2. Pinned in Task 4.
5. **Deleting one row of a split receipt** keeps the photo for the other row; deleting the last row removes it from R2. Pinned in Task 5.

---

### Task 1: Data model, config and shared limits

**Files:**
- Modify: `prisma/schema.prisma` (new `ReceiptPhoto` model; `Transaction` gains `receiptPhotoId`, relation, `@@index([receiptPhotoId])`; `User` gains `receiptPhotos ReceiptPhoto[]`)
- Create: `prisma/migrations/20261126120000_add_receipt_photos/migration.sql` (generated)
- Modify: `src/lib/receipt-limits.ts` (export `MAX_IMAGE_DIMENSION = 1500`), `src/lib/utils.ts:93` (import it instead of the private constant)
- Modify: `.gitignore` (add `.superpowers/`), `package.json` / `pnpm-lock.yaml` (aws4fetch)
- Modify: `AGENTS.md` Environment Variables (four `R2_*` entries, each one line: private bucket, token scoped to it with Object Read and Write, separate dev bucket locally)

**Interfaces:**
- Produces: Prisma `ReceiptPhoto { id, userId, objectKey (unique), contentType, byteSize, width, height, photoKey (unique per user), createdAt }`; `Transaction.receiptPhotoId: string | null`. `photoKey` is the client's idempotency key, `@@unique([userId, photoKey])`, `@map("photo_key")`.

- [ ] **Step 1:** Add the model exactly as the spec's Data model section, plus `photoKey String @map("photo_key")` and `@@unique([userId, photoKey])`. Relation from Transaction is `onDelete: SetNull`; from User is `onDelete: Cascade`.
- [ ] **Step 2:** Run `pnpm db:migrate --name add_receipt_photos` (local DB). Expected: one migration with `CREATE TABLE "receipt_photos"`, `ALTER TABLE "transactions" ADD COLUMN "receipt_photo_id"`, the FK and indexes, and no `DROP`.
- [ ] **Step 3:** Move `MAX_IMAGE_DIMENSION`, install aws4fetch, add `.superpowers/` to `.gitignore`, document the env vars.
- [ ] **Step 4:** Run `pnpm type-check && pnpm test src/lib/utils`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(receipts): add receipt_photos table and photo limits`.

### Task 2: R2 storage client

**Files:**
- Create: `src/lib/receipt-photo-storage.ts`
- Test: `src/lib/receipt-photo-storage.test.ts`

**Interfaces:**
- Produces:
  - `receiptPhotosEnabled(env?: NodeJS.ProcessEnv): boolean`
  - `interface PhotoStorage { put(key: string, body: Uint8Array, contentType: string): Promise<void>; get(key: string): Promise<Response>; delete(key: string): Promise<void> }`
  - `createPhotoStorage(env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): PhotoStorage` (throws `PhotosDisabledError` when not enabled)
  - `photoObjectKey(userId: string, photoId: string): string`

- [ ] **Step 1: Write failing tests**
  - `receiptPhotosEnabled` is false when any of the four vars is missing or `""`, true when all are set.
  - `photoObjectKey("u1", "p1") === "receipts/u1/p1.jpg"`.
  - `put` sends a signed `PUT` to `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{R2_BUCKET}/receipts/u1/p1.jpg` with an `authorization` header starting `AWS4-HMAC-SHA256` (stub `fetchImpl`, assert on the captured request).
  - `get` returns the response on 200; throws `PhotoNotFoundError` on 404; any other non-2xx throws `PhotoStorageError`.
  - `delete` treats 404 as success (idempotent).
- [ ] **Step 2:** Run `pnpm test src/lib/receipt-photo-storage.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement with `AwsClient` from `aws4fetch` (`service: "s3"`, `region: "auto"`), passing `fetchImpl` through so tests need no network. Server-only: add `import "server-only"` if the project uses it, otherwise a header comment; never import from client code.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(receipts): R2 storage client for receipt photos`.

### Task 3: Image normalisation

**Files:**
- Create: `src/lib/receipt-photo-image.ts`
- Test: `src/lib/receipt-photo-image.test.ts`

**Interfaces:**
- Produces: `normaliseReceiptPhoto(input: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }>`; throws `UnreadableImageError` for bytes `sharp` cannot decode.

- [ ] **Step 1: Write failing tests** (build fixtures in-test with `sharp`, no binary fixtures committed):
  - a 3000×2000 JPEG with EXIF GPS and `orientation: 6` comes back ≤1500 on its longest side, upright (width < height after rotation), and `sharp(out).metadata()` has no `exif`, `gps`, `icc` or `xmp`.
  - an 800×600 PNG comes back JPEG (`format === "jpeg"`) and 800×600, not enlarged.
  - `new Uint8Array([1, 2, 3])` rejects with `UnreadableImageError`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement: `sharp(input).rotate().resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true })`. `sharp` drops metadata unless `withMetadata` is called, so do not call it.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(receipts): re-encode receipt photos and strip metadata`.

### Task 4: Photo service and upload/serve routes

**Files:**
- Create: `src/lib/receipt-photos.ts` (service, dependency-injected like `transaction-writes.ts`)
- Create: `src/app/api/receipt-photos/route.ts` (POST), `src/app/api/receipt-photos/[id]/route.ts` (GET bytes), `src/app/api/receipt-photos/[id]/info/route.ts` (GET info)
- Test: `src/lib/receipt-photos.test.ts`, `src/app/api/receipt-photos/route.test.ts`, `src/app/api/receipt-photos/[id]/route.test.ts`

**Interfaces:**
- Consumes: `PhotoStorage`, `photoObjectKey` (Task 2); `normaliseReceiptPhoto` (Task 3); `getAuthUserId` (`src/lib/session.ts:12`); upload checks from `src/lib/receipt-guard.ts` (`checkBodySize`, `resolveMimeType`).
- Produces:
  - `storeReceiptPhoto(deps: { prisma; storage: PhotoStorage }, params: { userId: string; photoKey: string; bytes: Uint8Array }): Promise<{ photo: ReceiptPhotoView; replayed: boolean }>`
  - `type ReceiptPhotoView = { id: string; width: number; height: number; byteSize: number; createdAt: string }`
  - `getReceiptPhotoInfo(prisma, userId: string, photoId: string): Promise<{ photo: ReceiptPhotoView; transactions: { id: string; description: string; amount: number; type: "INCOME" | "EXPENSE"; categoryName: string; localDate: string }[]; total: number } | null>`
  - `deleteUnreferencedPhotos(deps: { prisma; storage }, userId: string, photoIds: string[]): Promise<string[]>` (returns deleted ids; per photo, takes `FOR UPDATE` on the photo row as its own first statement, runs the guarded row delete on the fresh snapshot that follows, and deletes the R2 object only when that row was really deleted; skips any photo still referenced. Row first, never object first: an object deleted before the re-check can be one a transaction linked a moment earlier. See "Cleanup and its locking" in `.claude/rules/receipts.md`)
  - `POST /api/receipt-photos`: multipart `photo` (File), `photoKey` (UUID). 201 `{ photo: ReceiptPhotoView }`; 200 on replay of the same `photoKey`.
  - `GET /api/receipt-photos/[id]`: `image/jpeg` stream.
  - `GET /api/receipt-photos/[id]/info`: the `getReceiptPhotoInfo` result as JSON, 404 when null.

- [ ] **Step 1: Write failing service tests** (Prisma and storage stubbed):
  - `storeReceiptPhoto` normalises, PUTs to `receipts/{userId}/{id}.jpg`, then creates the row; a second call with the same `userId` + `photoKey` returns `replayed: true` and calls `storage.put` zero more times.
  - if the row insert throws, the just-written object is deleted and the error is rethrown.
  - `deleteUnreferencedPhotos(deps, "u1", ["p1", "p2"])` where p1 still has a transaction deletes only p2: the lock, then the row, then the object, in that order.
  - `getReceiptPhotoInfo` returns null for another user's photo; `total` is the sum of linked amounts.
- [ ] **Step 2: Write failing route tests:**
  - POST without a session → 401; with R2 disabled → 503 `PHOTOS_DISABLED`; `application/pdf` → 415; a body over `MAX_FILE_SIZE` → 413; undecodable bytes → 422 `{ error: "That file isn't a readable image." }`; missing or non-UUID `photoKey` → 400. None of these call `storage.put`.
  - GET bytes for another user's id → 404; own id → 200 with `content-type: image/jpeg` and `cache-control: private, no-store`.
  - GET info for another user's id → 404.
- [ ] **Step 3:** Run both test files. Expected: FAIL.
- [ ] **Step 4:** Implement the service, then the three routes as thin wrappers (session, enabled check, map errors to status). Keep each route body under 50 lines.
- [ ] **Step 5:** Add a case to `src/lib/protected-paths.test.ts` (or the `sw.ts` matcher test if that is where `/api` lives) asserting `/api/receipt-photos/abc` is NetworkOnly.
- [ ] **Step 6:** Run `pnpm test src/lib/receipt-photos src/app/api/receipt-photos src/lib/protected-paths`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(receipts): upload and serve receipt photos through owner-checked routes`.

### Task 5: Transactions carry `receiptPhotoId`

**Files:**
- Modify: `src/lib/validations.ts` (`transactionSchema` and `batchTransactionSchema` gain `receiptPhotoId: z.string().min(1).max(100).nullable().optional()`)
- Modify: `src/lib/receipt-photos.ts` (add linking helpers)
- Modify: `src/app/api/transactions/route.ts` (POST), `src/app/api/transactions/[id]/route.ts` (PUT, DELETE), `src/app/api/transactions/batch/route.ts` (POST, DELETE), `src/lib/transaction-writes.ts` (`createTransactionBatch` writes `receiptPhotoId`)
- Test: `src/lib/receipt-photos.test.ts`, the three route test files, `src/lib/transaction-writes.test.ts`

**Interfaces:**
- Consumes: `deleteUnreferencedPhotos` (Task 4).
- Produces:
  - `photosAreOwned(tx, userId: string, photoIds: string[]): Promise<boolean>`
  - `applyPhotoChange(tx, userId: string, transactionId: string, next: string | null, previous: string | null): Promise<{ orphaned: string[] }>`. Replace (`next` set, `previous` set and different) repoints **every** transaction with `previous` to `next`; remove (`next` null) unlinks only `transactionId`; returns photo ids that may now be unreferenced.
  - MCP `create_transactions` input schema must **not** gain `receiptPhotoId` (its own zod shape strips it); add an assertion to `src/lib/mcp/server.test.ts`.

- [ ] **Step 1: Write failing tests:**
  - POST `/api/transactions` with another user's `receiptPhotoId` → 400 `{ error: "Photo not found" }`, no row created.
  - batch POST with one foreign photo id among valid ones → 400, nothing created (all-or-nothing, like categories).
  - PUT replacing photo A with B on one row of a split (two rows on A) → both rows on B, and A is passed to `deleteUnreferencedPhotos` after commit.
  - PUT with `receiptPhotoId: null` on one row of a split → only that row unlinked; A not deleted (still referenced).
  - PUT omitting `receiptPhotoId` → link untouched, and the "no change writes nothing" rule (`PUT` writes nothing when nothing moved) still holds.
  - DELETE of the last row on photo A → A deleted from storage; DELETE of one of two rows → A kept. Same for batch DELETE.
  - Photo ownership is checked inside the write transaction, beside `categoriesAreUsableForWrite`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Storage deletes run **after** the Prisma transaction commits and never fail the request (log with `console.warn`, the orphan is left for Task 10's script). Replace takes `SELECT ... FOR UPDATE` on the affected transaction rows ordered by id, first statement in the transaction.
- [ ] **Step 4:** Run the tests, then `pnpm test src/app/api/transactions src/lib/transaction-writes src/lib/mcp` and `cd mcp-server && pnpm type-check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(receipts): link, replace and clean up photos through transaction writes`.

### Task 6: Client plumbing

**Files:**
- Create: `src/hooks/use-receipt-photos.ts`
- Modify: `src/components/user-provider.tsx` (`UserInfo.receiptPhotosEnabled: boolean`, default `false`), `src/app/(app)/layout.tsx` (set it from `receiptPhotosEnabled()`)
- Test: `src/hooks/use-receipt-photos.test.tsx`

**Interfaces:**
- Produces:
  - `receiptPhotoUrl(photoId: string): string` → `/api/receipt-photos/${photoId}`
  - `uploadReceiptPhoto(file: File, photoKey: string): Promise<ReceiptPhotoView>` (throws `ApiError` from `src/hooks/api-error.ts` on non-2xx)
  - `useReceiptPhotoInfo(photoId: string | null)` (React Query, key `["receipt-photo-info", photoId]`, disabled when null)

- [ ] **Step 1: Write failing tests:** `uploadReceiptPhoto` posts `FormData` with `photo` and `photoKey` to `/api/receipt-photos` and returns `photo`; a 503 rejects with an `ApiError` whose status is 503; `useReceiptPhotoInfo(null)` makes no request.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and wire the user flag.
- [ ] **Step 4:** Run, plus `pnpm type-check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(receipts): client hooks and enabled flag for receipt photos`.

### Task 7: Edit and Add form with a photo (option C, B's attach field)

**Files:**
- Modify: `src/components/ui/modal.tsx` (prop `size?: "default" | "wide"`; wide is `max-w-[840px]` at `lg`, unchanged below `lg` and on mobile)
- Create: `src/components/transactions/receipt-photo-panel.tsx` (desktop left pane: image, zoom in, zoom out, fit, "Also on {category}" line)
- Create: `src/components/transactions/receipt-photo-strip.tsx` (below `lg`: 150px strip, "Tap to open")
- Create: `src/components/transactions/attach-photo-field.tsx` (dashed "📎 Attach photo" button; hidden `<input type="file" accept="image/*">`, no `capture`)
- Modify: `src/components/transactions/transaction-form.tsx` (holds `receiptPhotoId` in form state; renders the attach field after Labels when none; "Replace photo · Remove photo" under the fields when one exists; exposes `hasPhoto` to its caller through an `onPhotoChange?(photoId: string | null)` prop)
- Modify: `src/app/(app)/transactions/page.tsx`, `src/app/(app)/dashboard/page.tsx` (two-column layout and `size="wide"` when the form has a photo, at `lg` and up)
- Test: `src/components/transactions/attach-photo-field.test.tsx`, `src/components/transactions/transaction-form.test.tsx`

**Interfaces:**
- Consumes: `uploadReceiptPhoto`, `receiptPhotoUrl` (Task 6); `compressImage` (`src/lib/utils.ts`); `useUser().user.receiptPhotosEnabled`.

- [ ] **Step 1: Write failing tests:**
  - with `receiptPhotosEnabled: false` the attach field does not render.
  - choosing a file calls `compressImage` then `uploadReceiptPhoto` once with a UUID `photoKey`; on success the form submits `receiptPhotoId` equal to the returned id.
  - when upload rejects, the form still submits (without `receiptPhotoId`) and shows the Global Constraints toast copy.
  - Remove photo submits `receiptPhotoId: null`; an untouched form omits the key.
  - the attach button has an accessible name "Attach photo" and a hit area of at least 44×44px (`min-h-11`).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The panel and strip render `<img src={receiptPhotoUrl(id)}>`; zoom is CSS `transform: scale()` with a pointer drag, built on `motion` (already a dependency). Components stay under 150 lines each.
- [ ] **Step 4:** Run the tests and `pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Check by hand in `pnpm dev`: desktop at 1440px shows the photo left and form right; 375px shows the strip above the toggle; a transaction without a photo keeps today's width.
- [ ] **Step 6:** Commit `feat(receipts): show and attach receipt photos in the transaction form`.

### Task 8: Viewer, list badge, hide-amounts blur

**Files:**
- Create: `src/components/transactions/receipt-photo-viewer.tsx` (full-screen; pinch and wheel zoom; linked rows with category and amount; summed total; Download and Replace)
- Modify: `src/components/transactions/transaction-row-badges.tsx` (prop `receiptPhotoId?: string | null`; badge "Photo" with Lucide `Camera`, classes `bg-cream-200 text-warm-500`, matching "Itemized" sizing), and its caller on the transactions page
- Modify: the panel and strip from Task 7 (blur with `blur-md` while `usePrivacy().hideAmounts`, cleared on tap)
- Test: `src/components/transactions/receipt-photo-viewer.test.tsx`, `src/components/transactions/transaction-row-badges.test.tsx`

**Interfaces:**
- Consumes: `useReceiptPhotoInfo` (Task 6).

- [ ] **Step 1: Write failing tests:** the badge renders "Photo" only when `receiptPhotoId` is set; the viewer lists "Groceries ₱190.95", "Home Supplies ₱205.00" and "Receipt total ₱395.95" for a stubbed info response; the strip is blurred with hide-amounts on and unblurred after a click; Download is an `<a download>` to `receiptPhotoUrl(id)`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(receipts): full-screen receipt viewer and photo badge`.

### Task 9: Scans keep their photo (web)

**Files:**
- Modify: `src/hooks/use-multi-scan.ts` (`saveAll`, around lines 495-560)
- Test: `src/hooks/use-multi-scan.test.tsx`

**Interfaces:**
- Consumes: `uploadReceiptPhoto` (Task 6); batch rows accept `receiptPhotoId` (Task 5).

- [ ] **Step 1: Write failing tests:**
  - two receipts (one split into two rows sharing `receiptGroupId`, one single) → two uploads, then one batch whose rows carry the matching `receiptPhotoId` (split rows share one id).
  - the pending save (`pendingSaveRef`) stores each receipt's `photoKey` and uploaded id, so a retry after an unconfirmed save re-sends the same `photoKey`s (the server replays) and the same `receiptPhotoId`s.
  - one upload rejects → that receipt's rows save without `receiptPhotoId`, the others keep theirs, and the toast copy from Global Constraints appears once.
  - with `receiptPhotosEnabled: false` no upload happens and the batch is unchanged from today.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement: before `batchCreateMutation.mutateAsync`, upload each distinct receipt image (by `receiptGroupId`, or by item id for a single-row receipt) with up to 3 concurrent uploads; put results on the pending save so a replay reuses them.
- [ ] **Step 4:** Run the file and `pnpm test src/hooks`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(receipts): keep the photo when scanned receipts are saved`.

### Task 10: Telegram bot, MCP tool, scripts and docs

**Files:**
- Modify: `src/lib/mcp/scopes.ts` (`attach_receipt_photo: "transactions:write"`), `src/lib/mcp/server.ts` (register after `update_transactions`, line ~1416, same `resolveWritePermission(scopes, writesEnabledUntil, "transactions:write")` pattern), `src/lib/mcp/output-schemas.ts` (output pinned with `assertExact`)
- Modify: `src/lib/telegram/pending-scan.ts` (`PendingScan.imageBase64?: string`), `src/lib/telegram/bot.ts` (keep the image on the pending scan; after `confirmPendingScan` returns `saved`, call `attach_receipt_photo` with the created ids and `photoKey` = `updateBatchId(BOT_ID, scan.updateId)`; on failure append "The photo didn't upload: attach it from the app." to the confirmation)
- Create: `scripts/verify-receipt-photos.ts`, `scripts/prune-orphan-receipt-photos.ts`
- Modify: `.claude/rules/receipts.md`, `.claude/rules/api-routes.md`, `.claude/rules/mcp.md` (tool count and the new tool), `CHANGELOG.md`
- Test: `src/lib/mcp/server.test.ts`, `src/lib/telegram/confirm-scan.test.ts` (or the bot test that covers `saveConfirmedScan`)

**Interfaces:**
- Consumes: `storeReceiptPhoto`, `applyPhotoChange`, `photosAreOwned` (Tasks 4-5).
- Produces: MCP tool `attach_receipt_photo({ transactionIds: string[] (1-50), imageBase64: string (≤ MAX_BASE64_LENGTH), photoKey: string })` → `{ photoId: string; attachedTo: string[]; replayed: boolean }`. Not `readOnlyHint`; `idempotentHint: true`; `destructiveHint: true` (it replaces an existing photo).

- [ ] **Step 1: Write failing tests:** a token without `transactions:write` does not see the tool; a transaction id the user does not own → tool error naming it, nothing stored; the same `photoKey` twice → `replayed: true`, one `storage.put`; the bot calls the tool only after a `saved` outcome, never on `retryable`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the tool and the bot change.
- [ ] **Step 4:** Write `scripts/prune-orphan-receipt-photos.ts`: lists `receipt_photos` rows with no transactions and older than 24 hours, plus R2 objects under `receipts/` with no row; deletes only with `--apply`. Write `scripts/verify-receipt-photos.ts` against a dev bucket and `BASE_URL`: throwaway user, upload a JPEG carrying GPS EXIF, read it back through the route and assert no GPS, create a transaction with it, replace, remove, delete, then assert the bucket holds nothing for that user; deletes its user at the end.
- [ ] **Step 5:** Run `pnpm lint && pnpm type-check && pnpm test && (cd mcp-server && pnpm type-check)`. Expected: PASS. Then, with dev R2 credentials in `.env`: `pnpm dev -p 3111` and `BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env scripts/verify-receipt-photos.ts`. Expected: all PASS.
- [ ] **Step 6:** Update the rules files and `CHANGELOG.md`.
- [ ] **Step 7:** Commit `feat(receipts): keep Telegram receipt photos via attach_receipt_photo`.
