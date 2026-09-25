# BB ↔ BC Integration Sprint — 2 Weeks to Live

**Goal:** Treager family runs their active construction project through Building Block (GC side) and BuildChain (lender/admin side) — fully connected, no manual handoffs.

---

## The Architecture (What's Already Built)

```
Building Block (BB)                    BuildChain (BC)
Python/Flask · Fly.io                  Next.js · Vercel · Supabase
        │                                        │
        │── POST /api/buildingblock/ensure-project ──▶ Creates project + borrower/lender rows
        │── POST /api/buildingblock/submit ──────────▶ Creates draw_request + line_items + lien_waivers
        │── GET  /api/draws/{draw_id} ───────────────▶ Polls draw status (submitted→approved→funded)
        │                                        │
        │◀── Inspector portal (/api/inspections/[token]) ── Inspector signs off in BC
        │◀── Lender portal (/lender/approvals) ──────────── Lender reviews + approves in BC
        │◀── Admin portal (/admin/draws) ─────────────────── Jason reviews everything
```

---

## WEEK 1 — Verify & Wire

### Day 1: Environment Variables (30 min)

#### BC (Vercel) — verify these are set:
| Variable | Value |
|---|---|
| `BUILDINGBLOCK_API_KEY` | Any strong secret (e.g. `bc_bb_key_XXXXXXXX`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

Check: Vercel Dashboard → buildchain-app → Settings → Environment Variables

#### BB (Fly.io) — set these secrets:
```bash
fly secrets set BUILDCHAIN_API_URL=https://buildchain.finance --app building-block-app
fly secrets set BUILDCHAIN_API_KEY=bc_bb_key_XXXXXXXX --app building-block-app
```
(Use the SAME value as `BUILDINGBLOCK_API_KEY` in Vercel)

---

### Day 2: API Connectivity Test (use test_bc_api.py — see below)

Run from your machine to verify BC is accepting API calls:
```bash
python test_bc_api.py
```

Expected output:
```
[1/3] ensure-project ... OK  bc_project_id=xxxxxxxx
[2/3] submit draw    ... OK  draw_id=xxxxxxxx status_url=https://buildchain.finance/api/draws/xxxxxxxx
[3/3] poll status    ... OK  status=submitted
All 3 checks passed. BB ↔ BC API is live.
```

---

### Day 3-4: Drop buildchain_client.py into BB App

Add `buildchain_client.py` to your BB Python app (see below).

Then in BB, wherever a project is created, call:
```python
from buildchain_client import BuildChainClient
bc = BuildChainClient()

# When GC creates a project in BB:
result = bc.ensure_project(
    name="Treager Residence",
    address="123 Main St",
    city="Scottsdale",
    state="AZ",
    loan_amount=850000,
    loan_number="TRG-2026-001",
    property_type="residential",
    borrower_name="Treager Family Trust",
    lender_name="N/A"
)
bc_project_id = result["bc_project_id"]

# When GC submits a draw in BB:
draw_result = bc.submit_draw(
    bc_project_id=bc_project_id,
    loan_number="TRG-2026-001",
    draw_number=1,
    total_amount=45000,
    description="Foundation and framing draw #1",
    line_items=[...],  # G703 rows
    lien_waivers=[...],
)
draw_id = draw_result["draw_id"]

# Poll for status (run on a schedule or webhook):
status = bc.get_draw_status(draw_id)
# status["status"] will be: submitted → pending → approved → funded
```

---

### Day 5: Full End-to-End Test

Run through the complete flow manually:

| Step | Who | Platform | What to verify |
|---|---|---|---|
| 1 | Jason (as GC) | BB | Create "Treager Residence" project |
| 2 | Auto | BB→BC | ensure-project fires → project appears in BC /admin/projects |
| 3 | Jason (as GC) | BB | Submit Draw #1 ($15,000 foundation) |
| 4 | Auto | BB→BC | submit fires → draw appears in BC /admin/draws with badge counter |
| 5 | Jason (as Admin) | BC | Review draw at /admin/draws → click Approve |
| 6 | Jason (as Inspector) | BC | Use inspector token portal → mark pass |
| 7 | Jason (as Admin) | BC | Confirm lien waiver → triggers dual-condition check |
| 8 | Auto | BC→XRPL | EscrowFinish fires (testnet) → status → funded |
| 9 | BB polls | BB←BC | GET /api/draws/{id} → BB shows "Draw Released" to GC |

---

## WEEK 2 — Treager Onboarding

### Day 8-9: Create Treager Accounts

**BC (BuildChain admin panel):**
- Create borrower record for Treager Family Trust
- Create project: "Treager Residence" (use same loan_number as BB)
- Invite Treager to borrower portal (or Jason manages for now)

**BB (Building Block):**
- Set up Treager as GC user
- Walk them through the GC portal: project view, draw submission, inspection status
- Show them the AI assistant for draw validation

### Day 10-11: Live Walk-Through with Treager

Walk the Treagers through the complete flow:
1. "Here's your project in Building Block — this is your command center"
2. "Here's how you submit a draw — the AI will flag anything that looks off"
3. "Once you submit, it goes here (BC admin) for review"
4. "The inspector gets a link — they mark it pass, the lien waiver is confirmed, and funds release automatically"
5. "You'll see the status update here in Building Block when funds move"

### Day 12-14: First Real Draw

- Submit first actual draw on the Treager project
- Complete full cycle on testnet
- Capture timing data (submit → release) for the pilot ROI analysis

---

## What "Working" Looks Like

✅ GC submits draw in BB → appears in BC admin within 5 seconds  
✅ BC admin approval → BB shows status "pending" within 60 seconds (polling)  
✅ BC funded status → BB shows "Draw Released — $XX,XXX" to GC  
✅ Inspector portal link works from BC inspector tab  
✅ No data loss between platforms — all fields map correctly  
✅ Treager can use BB without touching BC (BC is the engine, not the interface for them)

---

## BC API Reference (for BB integration)

**Base URL:** `https://buildchain.finance`  
**Auth:** `Authorization: Bearer {BUILDCHAIN_API_KEY}` on all requests

### POST /api/buildingblock/ensure-project
```json
Request:
{
  "name": "Treager Residence",
  "address": "123 Main St",
  "city": "Scottsdale",
  "state": "AZ",
  "loan_amount": 850000,
  "loan_number": "TRG-2026-001",
  "property_type": "residential",
  "borrower_name": "Treager Family Trust",
  "lender_name": "N/A",
  "source": "building_block"
}

Response:
{
  "ok": true,
  "bc_project_id": "uuid",
  "loan_number": "TRG-2026-001",
  "created": true,
  "borrower_id": "uuid",
  "lender_id": null
}
```

### POST /api/buildingblock/submit
```json
Request:
{
  "loan_number": "TRG-2026-001",
  "draw_number": 1,
  "total_amount": 45000,
  "period_to": "2026-10-01",
  "description": "Foundation and framing",
  "retainage_rate": 0.10,
  "line_items": [
    {
      "line_no": "1",
      "description": "Excavation & Foundation",
      "scheduled_value": 80000,
      "work_completed_prev": 0,
      "work_completed_period": 35000,
      "materials_stored": 0
    }
  ],
  "lien_waivers": [
    {
      "sub_name": "AZ Foundation Co",
      "trade": "Foundation",
      "waiver_type": "conditional_partial",
      "through_amount": 35000,
      "signed_by": "Mike Rodriquez",
      "status": "signed"
    }
  ]
}

Response:
{
  "ok": true,
  "draw_id": "uuid",
  "draw_number": "BB-1",
  "status": "submitted",
  "total_amount": 45000,
  "retainage_held": 4500,
  "net_amount": 40500,
  "line_items_saved": 1,
  "lien_waivers_saved": 1,
  "status_url": "https://buildchain.finance/api/draws/uuid"
}
```

### GET /api/draws/{draw_id}
```json
Response:
{
  "id": "uuid",
  "status": "submitted",       // submitted | pending | approved | funded | declined
  "amount": 45000,
  "net_amount": 40500,
  "retainage_held": 4500,
  "inspection_done": false,
  "lien_waiver": true,
  "submitted_at": "2026-09-24T...",
  "approved_at": null,
  "funded_at": null,
  "project": { "name": "Treager Residence", "loan_number": "TRG-2026-001" }
}
```
