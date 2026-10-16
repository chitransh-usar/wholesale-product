# Bug & Error Audit

This document records the issues found in the project and their current status.

## Summary

An earlier pass documented five suspected defects. On re-inspection, **all five had
already been fixed in the code**, but the messaging feature was still broken because
of separate root causes that the earlier pass did not catch. Those have now been
fixed.

| # | Issue | Status |
|---|-------|--------|
| A | Socket.IO server never listens (`app.listen` instead of `httpServer.listen`) | **Fixed** |
| B | `messages` table has no migration (fresh DB has no table) | **Fixed** |
| C | Socket `send_message` handler drops `tempId`, breaking optimistic reconciliation | **Fixed** |
| D | `messagesRoutes` blocked brand-new conversations with a 403 | **Fixed** |
| E | Client dropped live messages on chats opened via URL (string/number id mismatch) | **Fixed** |
| F | Vite dev server crashes: `maplibre-gl-worker.mjs` missing from the optimize deps directory | **Fixed** |
| 1 | Messaging routes not mounted | Already fixed (mounted in `app.js`) |
| 2 | Invalid payment lifecycle transition | Already fixed (order created as `payment_pending`) |
| 3 | Order endpoints missing ownership checks | Already fixed (`ensureOrderAccess`) |
| 4 | Dashboard sidebar state undefined | Already fixed (`isSidebarOpen` state present) |
| 5 | Seller-upgrade columns missing on fresh DB | Already fixed (`add_seller_profile_columns.sql`) |

---

## A) Socket.IO server was never listening (critical)

### Affected file

- [server/src/server.js](server/src/server.js)

### Problem

`Socket.IO` was attached to `httpServer` (`new Server(httpServer, ...)`), but the
process called `app.listen(PORT)` — starting a *second*, plain Express server with no
websocket support — instead of `httpServer.listen(PORT)`. As a result the websocket
endpoint was never bound, every client socket connection failed, and no message could
be sent or received in real time. The REST endpoints (`GET /api/messages/chats`, etc.)
appeared to work, which is why "the messaging feature is there but not working."

### Fix

Listen on `httpServer` so both the REST API and Socket.IO are served from the same
port. Also hardened the `send_message` handler with input validation and a
try/catch so a bad insert can no longer crash the process.

---

## B) `messages` table had no migration

### Affected files

- [server/migrations/messaging_system.sql](server/migrations/messaging_system.sql) (new)
- [server/run_migrations.js](server/run_migrations.js)

### Problem

The messages router and the socket handler read/write a `messages` table
(`sender_id`, `receiver_id`, `message_text`, `is_read`, `created_at`), but no
migration created it. On a fresh database every messaging query fails with
`relation "messages" does not exist`.

### Fix

Added `messaging_system.sql` creating the `messages` table and its indexes, and
updated `run_migrations.js` to apply **all** `.sql` files in `migrations/` (it
previously ran only `reviews_system.sql`, so new migrations were never applied).

---

## C) Optimistic message reconciliation was broken

### Affected files

- [server/src/server.js](server/src/server.js)
- [client/src/hooks/useConversation.jsx](client/src/hooks/useConversation.jsx)

### Problem

The client sends `{ receiverId, text, tempId }` and expects the `message_sent` echo
to carry `tempId` so it can swap the optimistic bubble for the real saved row. The
server destructured only `{ receiverId, text }` and echoed the DB row without
`tempId`, so the optimistic message was never reconciled.

### Fix

The server now echoes `tempId` back on `message_sent` and emits `message_error`
(with `tempId`) on failure; the client reconciles on success and removes the stuck
optimistic bubble on error.

---

## D) New conversations were blocked with a 403

### Affected file

- [server/src/routes/messagesRoutes.js](server/src/routes/messagesRoutes.js)

### Problem

`ensureConversationAccess` returned `403` whenever no message existed yet between the
two users, so a user could never *start* a chat. The client then stored the error
object in place of the message array, breaking the conversation view. The guard was
also redundant: every query is already scoped to the requesting user
(`WHERE (sender=me AND receiver=them) OR (sender=them AND receiver=me)`), so a user
can only ever read/modify their own messages.

### Fix

Removed the redundant guard. Brand-new conversations now return an empty array and
render the "Say hello" empty state; the integer/self-target validation is retained.

---

## E) Live messages dropped on URL-opened chats

### Affected file

- [client/src/hooks/useConversation.jsx](client/src/hooks/useConversation.jsx)

### Problem

`activeChatId` is a **string** when a chat is opened via `/messages/:vendorId` but a
**number** when selected from the chat list. The incoming-message filter compared it
strictly (`===`) against numeric DB ids, so real-time messages were dropped for
chats opened from a URL.

### Fix

Coerce the id with `Number(...)` before comparing.

---

## F) Vite dep-optimizer error for `maplibre-gl-worker.mjs`

### Symptom

```
The file does not exist at "…/client/node_modules/.vite/deps/maplibre-gl-worker.mjs"
which is in the optimize deps directory. The dependency might be incompatible with
the dep optimizer. Try adding it to `optimizeDeps.exclude`.
```

### Affected files

- [client/vite.config.js](client/vite.config.js)
- [client/package.json](client/package.json)
- [client/package-lock.json](client/package-lock.json)

### Problem

`maplibre-gl` is **not a dependency of this project**. It appears nowhere in
`client/src`, nowhere in `client/package.json`, and has zero entries in either
`package-lock.json`. So Vite's own suggestion — adding it to
`optimizeDeps.exclude` — is the wrong fix: there is no such dependency to
exclude. The error is a *stale dep-optimizer cache*: `client/node_modules/.vite/deps/`
still carries a metadata entry for a package whose bundled output is no longer on
disk, and Vite fails hard when it serves an entry it cannot read.

Two things in the repo made that stale-cache state easy to hit:

1. **`"wholesale-product": "file:.."` in `client/package.json`** — the client
   declared a dependency on the repository root, which *contains* `client`. npm
   materialised this as the symlink `client/node_modules/wholesale-product → ..`,
   creating an unbounded cycle
   (`client/node_modules/wholesale-product/client/node_modules/…`). Vite's dependency
   scanner crawls `node_modules`, so it could walk out of the client package, back
   through the repo root, and into unrelated trees — including whatever else lives on
   disk beside the project. This self-link served no purpose; the client imports
   nothing from the root package.

2. **Lazily discovered dependencies.** `optimizeDeps.include` was unset, so the
   optimizer only learned about a dependency when a module importing it was first
   requested. Subpath imports behind lazy routes (`gsap/all`) trigger a re-optimize
   and rewrite of `.vite/deps` *while the dev server is already serving from it* —
   the window in which "file does not exist in the optimize deps directory" appears.

### Fix

- Removed the `file:..` self-dependency from `client/package.json` and both of its
  `package-lock.json` entries (`".."` and `node_modules/wholesale-product`).
- Added `optimizeDeps.include` to `client/vite.config.js` listing every bare import
  the app uses, `gsap/all` included, so the dep cache is written once at startup
  rather than rewritten mid-session.

### Recovering a machine that already hit this

The cache must be cleared once; config changes do not repair an already-corrupt one.

```powershell
# from client/, with the dev server stopped
Remove-Item -Recurse -Force node_modules\.vite
npm install
npm run dev -- --force
```

### Note for Windows/OneDrive checkouts

This project is commonly checked out under `C:\Users\<user>\OneDrive\Desktop\…`.
OneDrive syncs and dehydrates files underneath `node_modules/.vite/` while Vite is
reading them, which reproduces this same class of error on its own. Either exclude
the project from OneDrive sync, or keep the working copy on a non-synced path such
as `C:\dev\wholesale-product`. As a last resort, point the cache outside the synced
tree in `vite.config.js`:

```js
cacheDir: path.join(os.tmpdir(), "vite-wholesale-product"),
```

---

## Validation

- Backend: `node --test tests/orderStatusService.test.js` → 3 passed, 0 failed.
- Frontend: `npm run build` → Vite production build succeeds.
