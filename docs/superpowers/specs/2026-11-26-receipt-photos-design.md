# Receipt photos on transactions: design

Date: 2026-11-26
Status: approved approach, design pending review

## Why

A scanned receipt's photo is thrown away today: the browser compresses it, Gemini reads it, and
only the extracted numbers are kept. On 2026-11-26 an SM Supermarket receipt was filed four weeks
early (PR #415), and the only way to settle the right date was to find the paper again.

The owner wants the photo kept for two jobs:

1. **Double-checking a date or amount later**, against what the paper actually says.
2. **Proving Work Budget expenses for reimbursement**, by showing the photo in the app or sending
   it individually.

## Goals

- Keep the photo of every receipt scanned through the app, single scan, multi-scan and the
  Telegram bot, and attach it to the transaction(s) it created.
- Let a photo be attached to any expense or income typed by hand, when adding or when editing it.
- Show the photo beside the form when editing, so a date or amount can be compared at a glance.
- Keep photos for as long as the transaction exists. No expiry, no automatic cleanup of a photo
  that is still attached.

## Non-goals

- **Export or bundling** (a month of Work Budget receipts as a PDF or zip). Explicitly not needed
  now: the owner shows the photo in the app or sends one at a time.
- **Photos from Claude's `scan_receipt` MCP tool.** It returns a draft and writes nothing, so there
  is no transaction to attach to at scan time.
- **More than one photo per transaction.** One photo per transaction; a long receipt shot in two
  halves is out of scope.
- **Re-scanning a stored photo** with Gemini.

## Anti-goals (a failure even if it works)

- A photo reachable without logging in: no public R2 bucket, no public or long-lived links.
  Receipts print part of a card number (the SM receipt shows `531826XXXXXX9184`).
- A photo written to the service worker's offline cache.
- A saved transaction lost, or a save blocked, because the photo failed to upload.
- GPS location or other camera metadata kept inside a stored photo.

## Approaches considered

**Where photos are stored** (decided by the owner): Cloudflare R2. Rejected: Postgres `bytea` (the
Postgres is shared with other apps on one VPS, and photos would bloat every backup), and a Coolify
volume (the production app has no persistent storage today, and files on a volume sit outside the
database backups).

**How bytes move** (decided by the owner, option A):

- **A. Everything through the app (chosen).** The browser or bot sends the photo to an app route,
  which checks the session and ownership, then writes to R2. Viewing goes through an app route that
  checks ownership and streams the bytes back. Nothing in R2 is reachable without the app, and the
  bucket needs no CORS. Photos are a few hundred KB and there is one user, so server bandwidth is
  irrelevant. It matches how scans already send image bytes to the app.
- **B. Browser uploads straight to R2 with presigned URLs.** Rejected: needs bucket CORS, a second
  "upload finished" confirmation step, and viewing through short-lived URLs that anyone holding them
  can open, all to save bandwidth that does not matter here.

**R2 client** (approved by the owner): [`aws4fetch`](https://www.npmjs.com/package/aws4fetch)
1.0.20, MIT, 65 KB. It signs plain `fetch` requests with SigV4, which covers PUT, GET and DELETE.
Rejected: `@aws-sdk/client-s3`, 3.3 MB for three verbs. This is the only new dependency.

## Design

### Data model

A photo is its own row, because a split receipt's rows share one photo.

```prisma
model ReceiptPhoto {
  id           String        @id @default(cuid())
  userId       String        @map("user_id")
  objectKey    String        @unique @map("object_key")   // receipts/{userId}/{id}.jpg
  contentType  String        @map("content_type")         // always image/jpeg after re-encode
  byteSize     Int           @map("byte_size")
  width        Int
  height       Int
  createdAt    DateTime      @default(now()) @map("created_at")
  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions Transaction[]
  @@index([userId])
  @@map("receipt_photos")
}

// on Transaction
receiptPhotoId String?       @map("receipt_photo_id")
receiptPhoto   ReceiptPhoto? @relation(fields: [receiptPhotoId], references: [id], onDelete: SetNull)
@@index([receiptPhotoId])
```

- The migration only **adds** a table and a nullable column, so it is safe under the
  expand/contract rule in `.claude/rules/deploys.md`: the old release keeps serving while
  `build:deploy` migrates.
- The object key carries only ids, never a description or amount.

### Storage module: `src/lib/receipt-photo-storage.ts`

- Wraps `aws4fetch`'s `AwsClient` with `putObject`, `getObject` (returns the response body stream)
  and `deleteObject`, against `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{R2_BUCKET}/{key}`.
- Reads four environment variables: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET`. With any of them blank or missing, `receiptPhotosEnabled()` is false and every photo
  route answers **503** with `code: "PHOTOS_DISABLED"`. The app works as before, with no attach UI.
- Imported only by server routes and the MCP tool, never by client code.

### Image processing: `src/lib/receipt-photo-image.ts`

Every stored photo is re-encoded server-side with `sharp` (already a dependency):

- rotated upright from EXIF orientation, then **all metadata stripped** (GPS, camera, capture time);
- resized to fit `MAX_IMAGE_DIMENSION` (1500px, the limit `compressImage` already uses), never
  enlarged. It is a private constant in `src/lib/utils.ts` today; move it to `receipt-limits.ts`
  and export it, so the client and server cannot drift;
- encoded as JPEG, quality ~80.

The browser's `compressImage` already strips metadata through the canvas, but the Telegram bot
sends original bytes, and a hand-attached photo is untrusted input, so the server does not rely on
the client. Upload validation (type, `MAX_FILE_SIZE`, body ceiling) reuses `receipt-guard.ts` and
`receipt-limits.ts` rather than adding a second set of rules.

### Routes (all behind the NextAuth session, all owner-checked)

| Route | Does |
|---|---|
| `POST /api/receipt-photos` | multipart: `photo` + `transactionIds[]` + `photoKey` (client UUID). Verifies every id belongs to the user, re-encodes, PUTs to R2, creates the row and links every listed transaction in one DB transaction. Replaces any photo those rows had. |
| `GET /api/receipt-photos/[id]` | Owner check, then streams the bytes from R2 with `Cache-Control: private, no-store`. 404 (not 403) for someone else's id. |
| `GET /api/receipt-photos/[id]/info` | Which of the user's transactions share this photo, with category, amount and the summed total, for the viewer. |
| `DELETE /api/transactions/[id]/receipt-photo` | Unlinks the photo from that one transaction. Deletes the R2 object and the row once no transaction references it. |

- **Idempotent upload.** `photoKey` is generated by the client before the first attempt and reused
  on retry, the same pattern as `clientBatchId`. A key that already produced a photo answers 200
  with that photo and writes nothing, so a retry after a lost response cannot store the photo twice.
- **Order of writes on upload:** PUT to R2 first, then the DB transaction. If the DB step fails, the
  route deletes the object it just wrote. If that delete also fails, the orphan is harmless and is
  listed by the verify script.
- **Replacing** points every transaction that shared the old photo at the new one (replacing from
  one row of a split replaces it for all), then deletes the old object and row.
- **Concurrent uploads** for the same transaction (a double tap, two tabs): the DB transaction takes
  `SELECT ... FOR UPDATE` on the target transaction rows first, ordered by id, so the second upload
  waits and then replaces the first rather than both linking. Old objects are deleted only after the
  DB transaction commits.
- **Deleting a transaction** removes its link (`onDelete: SetNull`). The routes that delete
  transactions (`DELETE /api/transactions/[id]` and the batch `DELETE`) then delete any photo left
  with no transactions, through one shared helper.
- **Orphans can still happen**: `budgettrackerdense`, the second app on this database, can delete
  transactions without knowing about photos, and an R2 delete can fail after a commit. Both leave a
  photo row or object nothing references, which costs storage and exposes nothing.
  `scripts/prune-orphan-receipt-photos.ts` lists them and deletes only with `--apply` (dry run by
  default, like `merge-custom-category-into-default.ts`).
- `/api/*` is already `NetworkOnly` in `src/app/sw.ts`, so photos never reach the offline cache.
  `src/lib/protected-paths.test.ts` gets a case asserting it.

### Saving a photo when a scan is saved

Transactions are always saved first, through the existing paths, unchanged. The photo is uploaded
**after** the save succeeds, so a failed upload can never cost a transaction.

- **Single scan** (`app-shell.tsx` → `TransactionForm` → `POST /api/transactions`): the compressed
  `File` is kept in scan state. After the create returns the new id, upload it.
- **Multi-scan** (`use-multi-scan.ts` → `POST /api/transactions/batch`): each item already holds
  `imageFile` and its `receiptGroupId`. After the batch save, upload one photo per receipt with all
  that receipt's transaction ids.
- **Telegram bot** (`confirm-scan.ts` writes through `create_transactions` over MCP): a new MCP tool
  `attach_receipt_photo` takes `transactionIds` and `imageBase64`, gated on `transactions:write`
  (which the bot's token already holds, so no re-mint), not read-only, with `photoKey` derived from
  the photo's update id so a replay is idempotent. It calls the same server function as the upload
  route. The MCP body ceiling (`MAX_MCP_BODY_BYTES`) already admits a base64 image. The bot's
  in-memory pending scan has to keep the image bytes until the user confirms, so it can attach them
  after `create_transactions` returns the new ids.
- When an upload fails, the save still stands and a toast says "Saved. The photo didn't upload:
  attach it from the transaction." The bot says the same in its confirmation.

### UI

**Edit transaction, with a photo (chosen option C).**

- Desktop (`lg` and up): the modal widens (about 840px) into two columns. Left: the photo on a dark
  panel with zoom in, zoom out and fit, plus "Also on Home Supplies" when the photo is shared.
  Right: the existing form, unchanged, with "Replace photo · Remove photo" under the fields.
- Phone and tablet: a ~150px strip of the photo across the top of the sheet with "Tap to open",
  opening the full-screen viewer.
- The existing "Itemized" breakdown stays where it is.

**Edit or add transaction, without a photo (option B's control).** A dashed "📎 Attach photo" field
after Labels. On phones it offers the camera or the photo library (`<input type="file"
accept="image/*">`, no `capture` attribute so both are offered). Choosing a photo compresses it with
`compressImage` and shows it in the wide layout straight away. On **Add**, the photo uploads after
the create succeeds; on **Edit**, it uploads on Update.

**Full-screen viewer.** Pinch and drag to zoom on touch, wheel and drag on desktop, built on the
existing Motion dependency rather than a new package. Below the photo: every transaction it is
attached to with category and amount, the summed total, and Download and Replace.

**Transactions list.** A "Photo" badge in `TransactionRowBadges`, styled like "Itemized"
(`bg-cream-200 text-warm-500`, a Lucide `Camera` icon). The list endpoint adds `receiptPhotoId` to
each row.

**Hide amounts.** With hide-amounts on, the strip, panel and thumbnails are blurred until tapped,
since a photo shows every amount the toggle hides.

Mockups: `.superpowers/brainstorm/2550719-1795675812/content/receipt-photo-layout.html` (option C,
with option B's attach field).

### Settings and setup (nothing is done until the owner says so)

- Production: create an R2 bucket (private, no public access, no CORS), an R2 API token scoped to
  that bucket with Object Read and Write, and the four `R2_*` variables in Coolify.
- Local: a separate dev bucket and token in `.env`, so local testing never touches production
  photos. Document all four variables in `AGENTS.md` under Environment Variables.

## Testing

- Unit tests with the R2 client stubbed: ownership refusal (404), replay of a `photoKey`,
  replace repointing every shared row, unlink deleting the object only when nothing references it,
  503 when R2 is not configured, metadata stripped by the re-encode (assert on `sharp` metadata of
  the output), the MCP tool's scope gating.
- Component tests: the attach field, the wide layout appearing once a photo exists, the badge.
- `scripts/verify-receipt-photos.ts` against a real dev bucket and database: upload, read back
  through the route, check no GPS survives, replace, unlink, delete, and list orphaned objects.
  Creates and deletes its own throwaway user, like the other verify scripts.
- Layout checked at 375px and desktop.

## Calls made by Claude (the owner may overrule)

- One photo per transaction; a split receipt shares one photo, and replace or remove from one row
  of a split applies to every row it is shared with (remove unlinks only that row).
- A photo is deleted from R2 once no transaction references it.
- Upload happens after the save, never before it, and a failed upload only shows a toast.
- The server strips all metadata, including capture time.
- `attach_receipt_photo` rides `transactions:write` rather than a new scope.
- Hide-amounts blurs photos.
- Photos are JPEG at the existing `MAX_IMAGE_DIMENSION`, moved to `receipt-limits.ts`.
- Concurrent uploads serialise on a row lock; orphans are cleaned by a dry-run-by-default script,
  never automatically.

## Left to the builder

- Component structure for the wide modal and the viewer, within the 150-line guideline.
- Exact zoom gesture implementation.
- How the client learns photos are enabled (a field on `/api/profile` or the user context).
