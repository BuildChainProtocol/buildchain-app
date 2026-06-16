# Building Block → BuildChain Integration

## What changes in Building Block

Replace the simulated `_tool_post_to_builtin` in
`building_block/agents/lender_submit_tools.py` with the implementation below.

When `BUILDCHAIN_URL` is set in the environment, the Lender Submit Agent
posts the full draw package to BuildChain instead of simulating a BuiltIn
call. If the env var is missing it falls back to the existing simulation.

---

## Step 1 — Add env vars to Building Block

In Building Block's `.env` (or Fly.io secrets):

```
BUILDCHAIN_URL=https://buildchain-app.vercel.app
BUILDCHAIN_API_KEY=D1KuGEixs6cBQJRLC0zg9MyjhvUb032pqe5Pwkr4
BUILDCHAIN_LOAN_NUMBER=<the loan_number of the project in BuildChain>
```

`BUILDCHAIN_LOAN_NUMBER` is how Building Block tells BuildChain which project
to attach the draw to. Use the same value shown in the BuildChain admin UI
for this project (e.g. "BC-2024-001").

---

## Step 2 — Replace `_tool_post_to_builtin` in lender_submit_tools.py

Find the function `_tool_post_to_builtin` and replace it entirely with:

```python
def _tool_post_to_builtin(_: dict[str, Any], state: LenderSubmitAgentState) -> dict[str, Any]:
    """Post draw package to BuildChain (or simulate if not configured)."""
    import os, json as _json, urllib.request, urllib.error

    buildchain_url = os.getenv("BUILDCHAIN_URL", "").rstrip("/")
    api_key        = os.getenv("BUILDCHAIN_API_KEY", "")
    loan_number    = os.getenv("BUILDCHAIN_LOAN_NUMBER", "")

    if buildchain_url and api_key:
        # ── Live BuildChain submission ──────────────────────────
        manifest = state.submission_manifest or {}
        project  = state.project
        snap     = state.snapshot
        cov      = state.covenants

        # Build G703 line items from budget fixture
        try:
            budget_path = Path(__file__).resolve().parent.parent / "fixtures" / "budget.json"
            budget_data = _json.loads(budget_path.read_text(encoding="utf-8"))
            sov_lines   = budget_data.get("schedule_of_values", [])
        except Exception:
            sov_lines = []

        # Load current-period actuals if available
        try:
            actuals_path = Path(__file__).resolve().parent.parent / "fixtures" / "budget_actuals_14.json"
            actuals_data = _json.loads(actuals_path.read_text(encoding="utf-8"))
            actuals_by_line = {
                a["line"]: a for a in actuals_data.get("line_items", [])
            }
        except Exception:
            actuals_by_line = {}

        line_items = []
        for sov in sov_lines:
            line_no = sov.get("line", "")
            actual  = actuals_by_line.get(line_no, {})
            line_items.append({
                "line_no":              line_no,
                "description":          sov.get("description", ""),
                "scheduled_value":      sov.get("scheduled_value", 0),
                "csi_division":         line_no,
                "work_completed_prev":  actual.get("total_through_prior_period", 0),
                "work_completed_period": actual.get("work_completed_this_period", 0),
                "materials_stored":     actual.get("materials_stored", 0),
            })

        # Build lien waivers from fixture
        try:
            lw_path   = Path(__file__).resolve().parent.parent / "fixtures" / "lien_waivers.json"
            lw_data   = _json.loads(lw_path.read_text(encoding="utf-8"))
            lw_subs   = lw_data.get("subs", [])
        except Exception:
            lw_subs = []

        lien_waivers = [
            {
                "sub_name":      s.get("sub_name", ""),
                "sub_code":      s.get("sub_id", ""),
                "waiver_type":   s.get("waiver_type", "conditional_partial"),
                "through_amount": s.get("through_amount", 0),
                "status":        "signed" if s.get("status") in ("received", "signed") else "pending",
                "signed_by":     s.get("signed_by") or s.get("sub_name", ""),
            }
            for s in lw_subs
        ]

        # Inspection data from progress verify
        inspection = None
        try:
            pv_path   = Path(__file__).resolve().parent.parent / "fixtures" / "progress_verify.json"
            pv_data   = _json.loads(pv_path.read_text(encoding="utf-8"))
            insp      = pv_data.get("inspection", {})
            if insp:
                inspection = {
                    "inspector_name":            insp.get("inspector_name", "Third-Party Inspector"),
                    "inspector_company":         insp.get("company", ""),
                    "inspection_date":           insp.get("date", project.get("period_to", "")),
                    "outcome":                   "pass" if snap.get("verified_percent_complete", 0) > 0 else "pending",
                    "percent_complete_verified": snap.get("verified_percent_complete"),
                    "notes":                     insp.get("notes", ""),
                }
        except Exception:
            pass

        payload = {
            "loan_number":    loan_number or cov.get("lender_loan_id", ""),
            "draw_number":    project.get("draw_number"),
            "period_to":      project.get("period_to", ""),
            "total_amount":   manifest.get("net_disbursement", 0),
            "retainage_rate": project.get("retainage_rate", 0.05),
            "description":    manifest.get("approver_note", ""),
            "line_items":     line_items,
            "lien_waivers":   lien_waivers,
            "inspection":     inspection,
            "source":         "building_block",
        }

        endpoint = f"{buildchain_url}/api/buildingblock/submit"
        req_body = _json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=req_body,
            headers={
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                receipt_data = _json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            return {"error": f"BuildChain API {e.code}: {err_body}"}
        except Exception as e:
            return {"error": f"BuildChain API call failed: {e}"}

        receipt = {
            "provider":          "BuildChain",
            "draw_id":           receipt_data.get("draw_id"),
            "draw_number":       receipt_data.get("draw_number"),
            "status":            receipt_data.get("status", "submitted"),
            "total_amount":      receipt_data.get("total_amount"),
            "net_amount":        receipt_data.get("net_amount"),
            "retainage_held":    receipt_data.get("retainage_held"),
            "line_items_saved":  receipt_data.get("line_items_saved", 0),
            "lien_waivers_saved": receipt_data.get("lien_waivers_saved", 0),
            "inspection_saved":  receipt_data.get("inspection_saved", False),
            "review_url":        receipt_data.get("review_url"),
            "received_at":       datetime.now(timezone.utc).isoformat(),
            "next_step":         "BuildChain lender review in progress. Lender has been notified.",
        }

    else:
        # ── Simulated fallback (no env vars set) ────────────────
        ref = f"BC-SIM-{project.get('draw_number', 14):03d}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        receipt = {
            "provider":         "BuildChain (simulated)",
            "lender_reference": ref,
            "received_at":      datetime.now(timezone.utc).isoformat(),
            "status":           "received",
            "next_step":        "Set BUILDCHAIN_URL + BUILDCHAIN_API_KEY to submit for real.",
            "manifest_hash":    hashlib.sha256(
                _json.dumps(state.submission_manifest, sort_keys=True, default=str).encode()
            ).hexdigest(),
        }

    state.submission_receipt = receipt
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    (OUTPUTS / "buildchain_submission_receipt.json").write_text(
        _json.dumps(receipt, indent=2), encoding="utf-8"
    )
    state.emit({
        "type":     "submitted_to_buildchain",
        "provider": receipt.get("provider"),
        "draw_id":  receipt.get("draw_id"),
        "status":   receipt.get("status"),
    })
    state.record(
        "post_to_builtin",
        f"Submitted to BuildChain — draw_id: {receipt.get('draw_id') or receipt.get('lender_reference')}.",
        receipt=receipt,
    )
    return receipt
```

---

## Step 3 — Add budget_actuals_14.json fixture (if missing)

The function reads per-line actual amounts from `fixtures/budget_actuals_14.json`.
If this file doesn't exist yet, create it with this shape:

```json
{
  "project_id": "mercer-tower",
  "draw_number": 14,
  "line_items": [
    {
      "line": "01-100",
      "total_through_prior_period": 2695000.0,
      "work_completed_this_period": 385000.0,
      "materials_stored": 0
    }
  ]
}
```

---

## Step 4 — Deploy to Fly.io

```
fly secrets set BUILDCHAIN_URL=https://buildchain-app.vercel.app
fly secrets set BUILDCHAIN_API_KEY=D1KuGEixs6cBQJRLC0zg9MyjhvUb032pqe5Pwkr4
fly secrets set BUILDCHAIN_LOAN_NUMBER=<loan_number from BuildChain admin>
fly deploy
```
