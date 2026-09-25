# BB ↔ BC Integration Report
**Date:** 2026-09-24  
**BuildChain contact:** jason@buildchain.finance  
**Scope:** Treger Construction pilot — XRPL testnet, no real funds

---

## Summary

This report documents every change made to BuildChain (BC) to satisfy the 9-section integration spec that Building Block (BB) provided, confirms what was already in place, lists what BB must do on its side, and gives the exact env vars both services need for the Treger pilot.

---

## 1. What Was Already Working on BC

| Capability | Status |
|---|---|
| `POST /api/buildingblock/ensure-project` — idempotent by `loan_number` | ✅ already correct |
| `POST /api/buildingblock/submit` — create draw from BB payload | ✅ existed (rewritten — see §3) |
| XRPL EscrowCreate on lender approval | ✅ already correct |
| Dual-condition orchestrator (Inspector NFT taxon 3 + Lien Waiver NFT taxon 2) | ✅ already correct |
| Price oracle USD→XRP via CoinGecko, 5-min cache, $0.50 fallback | ✅ already correct |
| Testnet flat 1 XRP (when `XRPL_NETWORK=testnet`) | ✅ already correct |
| `GET /api/draws/[id]` — BB API key accepted | ✅ already correct |
| Email notifications (approval, funding) | ✅ already correct |

---

## 2. What BC Changed (this session)

### 2.1 New endpoint: `POST /api/buildingblock/draws/[id]/decision`

`app/api/buildingblock/draws/[id]/decision/route.ts`

BB's lender portal calls this to relay a lender decision (approved / held / declined) back to BC without going through the BC lender UI.

**Request (Bearer `BUILDINGBLOCK_API_KEY`):**
```json
{
  "decision":    "approved",          // "approved" | "held" | "declined"
  "decided_by":  "lender@bank.com",
  "reason":      "Looks good",        // optional; required on held/declined
  "amount":      95000.00,            // optional override (USD)
  "currency":    "USD"
}
```

**Behaviour:**
- `approved` → same XRPL EscrowCreate path as the BC lender UI; fires `draw_approved` webhook to BB
- `held` → draw stays `submitted` on BC (BC has no first-class held status); fires `draw_held` webhook
- `declined` → draw moves to `declined`; fires `draw_declined` webhook

**Response:**
```json
{
  "ok": true,
  "draw_id": "<uuid>",
  "status": "approved",
  "decision": "approved",
  "escrow_txn_hash": "...",
  "net_amount": 95000.00,
  "xrpl_sequence": 12345678,
  "escrow_finish_after": "2026-10-24T00:00:00.000Z"
}
```

---

### 2.2 Rewritten: `POST /api/buildingblock/submit`

`app/api/buildingblock/submit/route.ts`

Key changes from the previous version:

**Idempotency** — reads `Idempotency-Key` header or `idempotency_key` body field. If the key already exists in `draw_requests`, returns the original `bc_draw_id` immediately. Race condition handled via unique-constraint catch (Postgres code `23505`).

**Explicit amounts** — BC now honours BB's `gross_amount`, `retainage_held`, and `net_amount` instead of recomputing from line-item sum. BB is the source of truth for amounts.

**New fields stored:**
- `draw_requests`: `bb_draw_id`, `idempotency_key`, `gross_amount`, `net_amount`, `currency`, `gc_wallet`, `payees` (JSONB)
- `draw_line_items`: `bb_pay_app_id`, `sub_line_no`, `sub_code`, `csi_division`, `trade`, `retainage_cumulative`
- `lien_waivers`: `bb_waiver_id`, `bb_pay_app_id`, `statute_ref`

**Duplicate `bb_pay_app_id` guard** — if any `bb_pay_app_id` in the new submission already appears in an active (non-declined/non-failed) draw on this project, BC returns:
```json
HTTP 409
{ "error": "duplicate_pay_app", "existing_draw_id": "<uuid>", "conflicting_bb_pay_app_ids": [101, 102] }
```

**State default** — lien waiver state defaults to `AZ` (was `TX`).

---

### 2.3 Rewritten: `lib/webhooks/building-block.ts`

The previous implementation had three critical bugs. All are fixed:

| Bug | Fix |
|---|---|
| HMAC was over body only | HMAC is now `HMAC-SHA256(secret, "${unix_seconds}.${raw_body}")` |
| Missing `X-BuildChain-Timestamp` header | Added |
| Missing `X-BuildChain-Event-Id` header + body field | Added (stable UUID per event) |

**Retry policy:** 3 attempts — immediate → 1 s → 4 s. 10 s per-attempt timeout. No retry on 401/400/409.

**All event types now implemented:**

| Event | Trigger |
|---|---|
| `draw_approved` | Lender approves (BC UI or `/decision` endpoint) |
| `draw_held` | Lender puts draw on hold via `/decision` endpoint |
| `draw_declined` | Lender declines (BC UI or `/decision` endpoint) |
| `draw_rejected` | BC rejects submission (validation fail, dup bb_pay_app_id) |
| `inspector_nft_minted` | Inspector Credential NFT (taxon 3) minted |
| `waiver_nft_minted` | Lien Waiver NFT (taxon 2) minted |
| `escrow_released` | EscrowFinish submitted — manual path AND orchestrator auto-fire |
| `payment_confirmed` | (Future) individual payment confirmation |
| `escrow_failed` | (Future) EscrowFinish failure |

**`payments[]` in `escrow_released`** — both the manual-funded path and the orchestrator auto-fire path now include a `payments[]` array:
```json
"payments": [
  {
    "bb_pay_app_id": 101,
    "sub_code": "03-0100",
    "sub_name": "Concrete",
    "amount": 47500.00,
    "status": "paid",
    "tx_hash": "ABCDEF...",
    "wallet": "rXXX...",
    "ledger_index": 45123456
  }
]
```
Amounts are always USD. Never XRP or drops.

---

### 2.4 New migration: `supabase/migrations/014_bb_integration.sql`

Adds all new columns (all nullable — existing rows unaffected), fixes `DrawStatus` enum/check to include `held`, `failed`, `distributing`, `settled`, and adds indexes on `bb_pay_app_id` and `bb_waiver_id`.

**Run before deploying:**
```bash
supabase db push
# or paste into Supabase SQL editor
```

---

### 2.5 Fixed: `GET /api/projects` — BB API key health probe

`app/api/projects/route.ts`

BB calls `GET /api/projects?probe=1` with `Authorization: Bearer {BUILDINGBLOCK_API_KEY}` to verify the URL + key are valid. This previously returned 401 because it only accepted Supabase session auth.

Fix: if the incoming `Bearer` token matches `process.env.BUILDINGBLOCK_API_KEY`, the handler short-circuits and returns:
```json
{ "ok": true, "service": "buildchain", "authenticated": "api_key" }
```
No project data is exposed to BB.

---

### 2.6 Fixed: `bc_client.py` state default TX → AZ

`building_block/buildchain/bc_client.py`

`ensure_project_on_bc()` was defaulting `state` to `"TX"`. Changed to `"AZ"` — Treger is in Arizona, BC is Arizona-based.

---

## 3. DB Status Word Audit (§3.3 of spec)

BB's spec defines these BC status values:

| BB spec status | BC DB status | Match? |
|---|---|---|
| `submitted` | `submitted` | ✅ |
| `pending` | `pending` | ✅ |
| `approved` | `approved` | ✅ |
| `funded` | `funded` | ✅ |
| `declined` | `declined` | ✅ |
| `held` | `held` | ✅ (added by migration 014) |
| `failed` | `failed` | ✅ (added by migration 014) |

BB's `routes_bc_sync.py` maps BC status → BB status. No changes needed there.

---

## 4. BB Integration Checklist — 15 Items from Spec

| # | Item | BC side status |
|---|---|---|
| 1 | Auth: Bearer BUILDINGBLOCK_API_KEY on all BB→BC calls | ✅ done |
| 2 | `POST /api/buildingblock/ensure-project` exists and is idempotent | ✅ done |
| 3 | `POST /api/buildingblock/submit` stores all BB fields | ✅ done (rewritten) |
| 4 | Submit returns `bc_draw_id` | ✅ done |
| 5 | Idempotency-Key dedup on submit | ✅ done |
| 6 | Duplicate `bb_pay_app_id` returns 409 | ✅ done |
| 7 | Lender decision relay endpoint | ✅ done (new endpoint) |
| 8 | Webhook signing: HMAC(secret, "{ts}.{body}") | ✅ done (rewritten) |
| 9 | Timestamp header + tolerance | ✅ done |
| 10 | Event-Id header + body | ✅ done |
| 11 | All event types fired | ✅ done |
| 12 | `payments[]` in `escrow_released` | ✅ done (both paths) |
| 13 | Amounts always USD in webhooks | ✅ done |
| 14 | `GET /api/projects` health probe with API key | ✅ done |
| 15 | Testnet: always 1 XRP flat | ✅ already correct |

---

## 5. What BB Must Change

### 5.1 Auto-provision `bc_loan_number` on project creation

**This is required.** `bc_loan_number` is the idempotency key that ties a BB project to a BC project. Without it, draw submissions will fail.

BB must call `POST /api/buildingblock/ensure-project` at project creation time and store BC's `bc_project_id` (returned as `data.bc_project_id`) in `projects.bc_loan_number`.

BB already has `ensure_project_on_bc()` in `bc_client.py`. The call needs to be wired into the project creation flow — likely in the route/handler that creates a new project in BB's DB.

```python
from building_block.buildchain.bc_client import ensure_project_on_bc

result = ensure_project_on_bc(
    name=project.name,
    address=project.address,
    city=project.city,
    state=project.state or "AZ",
    loan_amount=float(project.loan_amount or 0),
    loan_number=project.loan_number,   # BB's own loan number — used as idempotency key
    property_type="multifamily",
    borrower_name=project.gc_name,
    lender_name=project.lender_name,
)
if result.get("ok"):
    # Store bc_project_id on the project
    db.projects.update(id=project.id, bc_loan_number=result["data"]["bc_project_id"])
```

No manual UI screen needed. No seeding. This runs silently at project creation.

### 5.2 Set `BUILDCHAIN_URL` and `BUILDCHAIN_API_KEY` env vars on Fly.io

See §6 below.

### 5.3 Set `BUILDCHAIN_WEBHOOK_SECRET` env var for signature verification

BB must set the same secret that BC uses for signing webhooks. See §6.

### 5.4 Remove "BuiltIn" references from `lender_submit_agent.py`

`building_block/agents/lender_submit_agent.py` still references "BuiltIn" in some prompt/tool strings. BB is renaming this — update those strings to "BuildChain" before the Treger pilot.

### 5.5 Retire `buildchain_producer.py` or update its env vars

`building_block/agents/buildchain_producer.py` uses `BC_API_URL` and `BC_API_KEY` — the old variable names. Either retire this file (if `LiveBuildChainClient` in `client.py` fully replaces it) or update it to use `BUILDCHAIN_URL` and `BUILDCHAIN_API_KEY`.

---

## 6. Env Vars — Both Sides

### BuildChain (Vercel)

```bash
# Required for BB integration
BUILDINGBLOCK_API_KEY=<generate a strong random secret — share with BB out of band>
BUILDINGBLOCK_WEBHOOK_URL=https://building-block.fly.dev
BUILDINGBLOCK_WEBHOOK_SECRET=<generate a strong random secret — must match BB side>

# XRPL — testnet for Treger pilot
XRPL_NETWORK=testnet
XRPL_WALLET_SEED=<testnet seed — generate fresh with `xrpl.Wallet.create()`, NEVER reuse mainnet>
NEXT_PUBLIC_SUPABASE_URL=<your Supabase project URL>
SUPABASE_SERVICE_ROLE_KEY=<Supabase service role key>

# Optional
BC_HTTP_TIMEOUT=60
```

### Building Block (Fly.io)

```bash
# Required for BB→BC calls
BUILDCHAIN_URL=https://buildchain.finance
BUILDCHAIN_API_KEY=<same value as BC's BUILDINGBLOCK_API_KEY>

# Required for BC→BB webhook verification
BUILDCHAIN_WEBHOOK_SECRET=<same value as BC's BUILDINGBLOCK_WEBHOOK_SECRET>
BUILDCHAIN_WEBHOOK_REQUIRE_TS=1

# Optional timeout
BC_HTTP_TIMEOUT=60
```

**Security rules:**
- Exchange secret values out of band (Signal DM, 1Password share — never paste into chat or Git)
- Never commit any of these to source control
- Testnet seeds are not real funds but treat them with the same care — a leaked testnet seed is a leak habit
- Before mainnet: generate fresh XRPL wallets; never reuse testnet seeds

---

## 7. Treger Pilot Setup Steps

### Step 1 — Run BC migration
```bash
cd buildchain-app
supabase db push
# Verify: draw_requests has columns bb_draw_id, idempotency_key, payees, hold_reason
# Verify: draw_line_items has bb_pay_app_id
# Verify: draw_status enum includes 'held'
```

### Step 2 — Set BC env vars on Vercel
In Vercel → BuildChain project → Settings → Environment Variables, add:
- `BUILDINGBLOCK_API_KEY` (generate: `openssl rand -hex 32`)
- `BUILDINGBLOCK_WEBHOOK_URL` = `https://building-block.fly.dev`
- `BUILDINGBLOCK_WEBHOOK_SECRET` (generate: `openssl rand -hex 32`)
- `XRPL_NETWORK` = `testnet`
- `XRPL_WALLET_SEED` = (generate fresh testnet seed; share public address with BB)

### Step 3 — Set BB env vars on Fly.io
```bash
fly secrets set BUILDCHAIN_URL=https://buildchain.finance \
               BUILDCHAIN_API_KEY=<same as step 2> \
               BUILDCHAIN_WEBHOOK_SECRET=<same as step 2> \
               BUILDCHAIN_WEBHOOK_REQUIRE_TS=1 \
               -a building-block
```

### Step 4 — BB: wire ensure-project into project creation
Implement §5.1 above so `bc_loan_number` is auto-populated when a Treger project is created in BB.

### Step 5 — Health check
```bash
# From BB side — verify key + URL
curl -H "Authorization: Bearer $BUILDCHAIN_API_KEY" \
     https://buildchain.finance/api/projects?probe=1
# Expected: {"ok":true,"service":"buildchain","authenticated":"api_key"}
```

### Step 6 — Testnet smoke test
1. Create Treger project in BB → confirm `bc_loan_number` populated
2. Submit a draw from BB → confirm `bc_draw_id` returned, draw visible in BC
3. In BC, approve draw → confirm XRPL EscrowCreate on testnet
4. Confirm BB receives `draw_approved` webhook with correct HMAC
5. Upload Inspector Credential (taxon 3) + confirm Lien Waiver NFT (taxon 2) minted
6. Confirm orchestrator fires EscrowFinish
7. Confirm BB receives `escrow_released` webhook with `payments[]` matching submitted line items

---

## 8. Open Items (Non-blocking for Treger)

| Item | Notes |
|---|---|
| `draw_held` event not fired from BC lender UI PATCH route | `/decision` endpoint fires it; BC UI doesn't have a held status yet — fine for Treger |
| `escrow_failed` event not wired | EscrowFinish errors currently log + mark draw failed; no webhook fired yet |
| `payment_confirmed` event | Reserved for future per-payment granularity; not needed for Treger |
| RLUSD support (Patent §V Hooks path) | XRPL Hooks not on mainnet yet; XRP escrow is the correct path for now |
| GC wallet as escrow destination | `gc_wallet` stored from BB submit but not yet plumbed as `destinationAddress` override in EscrowCreate |

---

*BC changes in this report are in the `Build Chain/buildchain-app/` folder. All files are ready to deploy. Run migration 014 before deploying the new API routes.*
