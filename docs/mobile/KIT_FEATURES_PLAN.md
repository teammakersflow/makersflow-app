# Course kits: inspection report and implementation plan

- **Written:** 2026-11-12, before any file was edited.
- **Scope:** mobile workspace only (`artifacts/mobile`).
- **Read-only:** the backend copy, the GitHub `makersflow-backend` (`main`) and `makersflow-website` (`feat/kit-claim`) were only read. GitHub was read through `gh api` into the scratchpad. Nothing was written to any repository.

## 1. Current state of the working tree

- The mobile workspace is not a git repository. Files changed **after** the previous session (2026-11-11 14:05–14:06, not by me) are treated as current work and built on, not replaced:
  - `app/course/[id].tsx`
  - `app/course/learn.tsx`
  - `lib/courseAccess.ts`
  - `services/enrollmentService.ts`
  - `services/notificationService.ts`
  - `tests/c5_consumption_only.test.ts`
  - `tests/entitlement_alignment.test.ts`
- **Baseline:** `node --test artifacts/mobile/tests/*.test.ts` gives **124 / 124 pass** (`_repair/logs/2026-11-12_mobile_tests_before_kits.log`).
- **Backend copy:** now on `staging/integration-2026-11-11`. B-1 was committed by the team as `6b7e1f0`. It was not modified.

## 2. Existing architecture (what will be reused)

| Area | Existing code | Notes |
|---|---|---|
| Course details | `app/course/[id].tsx` | Already fetches `GET /kits/course/:id` (`services/courseKitService.ts`, 2026-10-30) and renders an inline kit card **above the tab bar and description**: badge, items, per-item price when sold separately, out-of-stock note. It has no total, no add-to-cart and no claim. |
| Kit service | `services/courseKitService.ts` | Plain `fetch` (public route), reads `payload.data`, returns null on any error, so the screen is unchanged. Types say `price: string`. |
| Cart | `context/CartContext.tsx` | `addToCart(product)` adds **one** unit per call, ignores calls within 500 ms, and builds the new list from the current render's `items`. **Calling it in a loop drops items.** A duplicate product increments its quantity. Digital products are refused (C-5). Checkout is `app/store/checkout.tsx`. |
| Products | `services/productService.ts` | `getProductById` → `mapBackendProduct` gives the cart's `Product` shape (numeric price, `inStock`, category). |
| Addresses | `app/store/checkout.tsx` | `apiRequest('/shipping-addresses')` → `res.data` list (`id`, `full_name`, `address_line1/2`, `city`, `state`, `postal_code`, `phone`, `is_default`). No separate address screen exists; addresses are managed in checkout. |
| Razorpay | `components/RazorpayWebView.tsx` | Takes `{orderId, amount (paise), currency, keyId, name, email, phone, description}`, with `onSuccess(paymentId, orderId, signature)`, `onFailure` and `onDismiss`. Used only by store checkout (a C-5 test enforces this). |
| API client | `lib/auth/apiClient.ts` | `apiRequest`/`apiClient` return the parsed JSON body and throw `ApiError(status, message)` using the server's `message`. |
| Auth | `context/AuthContext.tsx` `useAuth()` | `user`, `isAuthenticated`. |
| Feature flags | `lib/auth/authFeatureFlags.ts` (object constant), `constants/commerce.ts` (`DIGITAL_COURSE_PURCHASES_IN_APP = false as const`) | Build-time constants, not environment variables. |
| Tests | `node --test` with type stripping, pure modules imported by relative path; static source checks for screens | |

## 3. Backend contracts (verified, not guessed)

**`GET /kits/course/:courseId`** (public). The body is wrapped by the global `ResponseInterceptor`: `{success, message, data}`.
- No kit, or kit not active: `data = { course_id, kit: null }` (no `kit_included` field).
- With a kit: `data = { course_id, kit: { id, name, description, items: [{ product_id, title, slug, quantity, price, image, available }], all_available }, kit_included, kit_purchase_required, label }`.
- `kit_included` is true only for a **paid** course; free courses get `kit_purchase_required: true`.
- `price` is a Prisma Decimal passed through `JSON.stringify`, so it **arrives as a string** (e.g. `"499"`). It is parsed defensively.

**`GET /included-kits/my`** (JWT, wrapped). The local staging copy **lacks** `shipping_address_id` and `payment_status`. The GitHub `main` version (commit `1d69b01`) and the website types have them. Per claim: `{ id, status, course_purchase_id, course: {id, title}, kit: {id, name, items[]}, shipping_address_id: string|null, payment_status: null|'not_required'|'pending'|'captured'|'failed', order: {id, status}|null, created_at }`.

**`POST /included-kits/claim`** (JWT, wrapped), body `{coursePurchaseId, shippingAddressId, idempotencyKey}`. `data` takes one of two shapes:
- **New attempt:** `{claimId, attemptId, orderId, shippingAmount: "x.xx", currency, paymentRequired, razorpayOrderId, razorpayKeyId, message}`.
- **Retry with the same key** (`main`): `{claimId, attemptId, orderId, order, reused: true, paymentRequired, paymentCaptured, alreadyFulfilled, fulfilledNow, requiresReconciliation, shippingAmount, amount (paise), currency, razorpayOrderId|null, razorpayKeyId|null, message}`.
- **Conflicts (409):** messages ending "…No new payment order was created." (`main`).

**`POST /included-kits/verify-payment`** (JWT). The body is `{razorpay_order_id, razorpay_payment_id, razorpay_signature}`. The result has `success` and `message`, so the interceptor does **not** wrap it: `{success, orderId, claimId, message}` or `{success, alreadyFulfilled, …}`.

**Website reference** (`feat/kit-claim`, `IncludedKitClaim.tsx` + `lib/includedKits.ts`, latest commit `4f2a377`):
- idempotency key `kit-claim-${claim.id}`;
- `shippingAddressId = claim.order ? (claim.shipping_address_id ?? selected) : selected`;
- the state order is fulfilled → captured → order+address (pay) → claim button / address picker;
- the result order is pay → reconciliation → fulfilledNow / alreadyFulfilled → confirmed;
- the error rule is /No new payment order was created/ → "try again shortly".

## 4. Plan

1. **`lib/courseKit.ts` (new, pure):**
   - parse the `/kits/course` payload (reads `data`; kit null → null);
   - normalise numbers;
   - card mode (`included` / `separate`);
   - total;
   - add-to-cart availability (respects `all_available`);
   - merge kit lines into cart lines (a duplicate product adds the kit quantity, matching how the existing cart treats a repeat add).
2. **`services/courseKitService.ts`:** use the parser. Errors still return null, so the screen looks exactly as before.
3. **`context/CartContext.tsx`:** add `addItemsToCart([{product, quantity}])`, an atomic functional update with the same C-5 physical-only filter. `addToCart` is left unchanged.
4. **`components/CourseKitCard.tsx` (new):**
   - It is the existing card moved out of the screen with identical styling, kept in the same place (top of the details content, above the tabs and description).
   - It adds the total and "Add kit to cart · ₹total", or a disabled "Kit currently unavailable" when `all_available` is false.
   - Before adding, it loads each product with `productService.getProductById` and adds all or nothing.
   - The kit-included text is made neutral (no "buy" wording, C-5).
5. **`constants/featureFlags.ts` (new):** `INCLUDED_KIT_CLAIM: false as const`, a build-time constant.
6. **`lib/includedKitClaim.ts` (new, pure):**
   - claim lookup by course id;
   - idempotency key;
   - view state;
   - request building (same key and the stored address on retries);
   - result interpretation;
   - Razorpay params;
   - the 409 message mapping.
7. **`services/includedKitService.ts` (new):** the three endpoints. Each refuses to run when the flag is off. verify-payment is read **unwrapped**.
8. **`components/IncludedKitClaim.tsx` (new):**
   - renders nothing when the flag is off;
   - otherwise handles the claim, address picker, Razorpay shipping payment (reusing `RazorpayWebView`), verify, and the status messages.
   - It is mounted only from the kit card, and only when `kit_included`.
9. **`tests/c5_consumption_only.test.ts`:** allow `components/IncludedKitClaim.tsx` as the second `RazorpayWebView` user (physical-goods shipping), and add assertions that it is flag-gated and kit-only.
10. **`tests/course_kits.test.ts` (new):**
    - parsing (null / included / separate / unavailable / string prices);
    - totals;
    - cart quantity merging;
    - claim states;
    - idempotency;
    - flag default OFF;
    - the claim UI and service inert when the flag is off;
    - static wiring.
11. **`_repair/WELCOME_EMAIL_TEST_CHECKLIST.md`:** a manual checklist (no app code change unless an app bug is found).
12. **Verify:** run the full mobile suite and `tsc --noEmit`, then report.

Backups of every edited file: `_repair/backup/2026-11-12-kits/`.

## 5. Results (2026-11-12)

**Status:** implemented in the mobile workspace. Not committed, not built, no APK, no payments made. The included-kit claim is **OFF** (`FEATURE_FLAGS.INCLUDED_KIT_CLAIM = false`).

### Files

| File | Change |
|---|---|
| `lib/courseKit.ts` | **New.** Payload parser (reads `data`; string or number prices), total, card mode, add-to-cart action, cart line merge |
| `services/courseKitService.ts` | Uses the parser; errors and no-kit still return null (screen unchanged) |
| `components/CourseKitCard.tsx` | **New.** The existing inline card moved out (same styling and position), plus the total, "Add kit to cart · ₹total" / disabled "Kit currently unavailable", all-or-nothing add via `getProductById`, neutral included-kit copy (no "buy" wording, C-5), and the flagged claim slot |
| `app/course/[id].tsx` | The inline card block (118 lines) is replaced by `<CourseKitCard>` in the same place; one import added. Nothing else changed. |
| `context/CartContext.tsx` | New `addItemsToCart` (atomic, physical-only, all or nothing). `addToCart` is unchanged. |
| `constants/featureFlags.ts` | **New.** `INCLUDED_KIT_CLAIM: false`, a build-time constant |
| `lib/includedKitClaim.ts` | **New.** Claim parsing and lookup, idempotency key, states, request body, result interpretation, 409 mapping |
| `services/includedKitService.ts` | **New.** The three endpoints; each refuses to run while the flag is off; verify-payment is read unwrapped |
| `components/IncludedKitClaim.tsx` | **New.** Claim / address / shipping payment UI; returns null before any hook while the flag is off |
| `tests/course_kits.test.ts` | **New.** 42 tests |
| `tests/c5_consumption_only.test.ts` | `IncludedKitClaim.tsx` added as the only other allowed `RazorpayWebView` user; **new** test that it is shipping-only, uses no course/store payment endpoint, and is flag-gated |
| `_repair/WELCOME_EMAIL_TEST_CHECKLIST.md` | **New.** Manual checklist (no app code change) |

Backups: `_repair/backup/2026-11-12-kits/`.

### Test evidence

| Check | Before | After |
|---|---|---|
| `node --test artifacts/mobile/tests/*.test.ts` | 124 / 124 | **167 / 167** (42 new kit tests + 1 new C-5 test) |
| `npx tsc --noEmit` (artifacts/mobile) | exit 0 | **exit 0** |
| Mutation: flag set to `true` | — | "defaults to OFF" tests **fail** (restored to `false`, file identical) |

Logs: `_repair/logs/2026-11-12_mobile_tests_after_kits.log`, `_repair/logs/2026-11-12_mobile_tsc_after_kits.log`.

### Decisions where the brief and the code differed

- **Card position:** kept where the existing card was, at the top of the details content under the title and stats, **above the tabs and description**. It is not above the hero image.
- **Mobile additions to the website states:** a claim with status `processing`, or an order with `payment_status: "not_required"` (free shipping), shows the processing message instead of a "Complete shipping payment" button for a payment that does not exist.
- **Missing payment fields:** when `paymentRequired` is true but the Razorpay order id or key is missing, the app shows an error. The website would show a success message.
- **Adding the kit twice** adds it twice, the same as tapping Add to cart twice on a product. A second tap during an in-flight add is ignored.

### Unresolved / follow-ups

1. **Backend contract:** the claim UI needs backend **`main`** (`payment_status`, `shipping_address_id`, reused-claim fields, "No new payment order" 409s). The local staging copy lacks them. The parser tolerates their absence; keep the flag OFF until `main` is deployed.
2. **No address management outside checkout:** the claim address picker tells users to add an address in the Store checkout. A proper address screen would be better before release.
3. **Existing bug, not changed:** in `app/store/[id].tsx`, **Buy now** adds quantity with `for (…) addToCart(product)`. The 500 ms debounce drops all but the first add, so a quantity above 1 becomes 1. `addItemsToCart` could fix it; this is out of scope here.
4. **Device QA** is required. See the summary for the manual tests.
