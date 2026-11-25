# BuildChain Protocol — Setup & Deployment Guide

## Overview

Full-stack construction loan management platform.
- **Frontend:** Next.js 14 (App Router) + Tailwind CSS
- **Backend:** Supabase (Auth + PostgreSQL + Storage)
- **Hosting:** Vercel (frontend) + Supabase (database)
- **Deploy time:** ~20 minutes

---

## Step 1 — Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Name it `buildchain-prod`, choose a region (US West for AZ users), set a strong DB password
3. Wait ~2 minutes for provisioning
4. Go to **Project Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret)

---

## Step 2 — Run Database Schema

In Supabase → **SQL Editor**, run these files in order:

1. **`supabase/migrations/001_initial_schema.sql`** — Creates all tables, RLS policies, storage buckets
2. **`supabase/migrations/002_functions.sql`** — Creates DB functions and notification triggers
3. **`supabase/seed.sql`** *(optional)* — Loads sample data (lenders, borrowers, projects, draws)

---

## Step 3 — Configure Auth

In Supabase → **Authentication → Settings:**
- **Site URL:** `https://your-app.vercel.app` (or `http://localhost:3000` for dev)
- **Redirect URLs:** Add `https://your-app.vercel.app/**`
- Email confirmations: Enable or disable as needed for dev

---

## Step 4 — Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.local.example .env.local
# Fill in your Supabase URL and keys

# 3. Run dev server
npm run dev
# → http://localhost:3000
```

---

## Step 5 — Deploy to Vercel

### Option A: Vercel CLI (fastest)
```bash
npm i -g vercel
vercel login
vercel --prod
```
Add environment variables when prompted.

### Option B: GitHub + Vercel Dashboard
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import from GitHub
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY` (optional — for email notifications)
4. Deploy → get your live URL

---

## Step 6 — Create First Users

After deployment, go to your live URL → `/signup` and create:

| Role | Email | Notes |
|------|-------|-------|
| `admin` | admin@buildchainprotocol.com | Platform admin (you) |
| `lender` | s.jennings@fwbank.com | First Western Bank |
| `borrower` | derek@mesabuilders.com | Mesa Builders LLC |

Then in Supabase → SQL Editor, link profiles to lenders/borrowers:
```sql
-- Link lender profile
UPDATE public.lenders SET profile_id = (SELECT id FROM auth.users WHERE email = 's.jennings@fwbank.com')
WHERE company_name = 'First Western Bank';

-- Link borrower profile
UPDATE public.borrowers SET profile_id = (SELECT id FROM auth.users WHERE email = 'derek@mesabuilders.com')
WHERE company_name = 'Mesa Builders LLC';
```

---

## Platform Features

### Admin (`/admin`)
- Platform overview with portfolio stats
- Project pipeline (kanban + table view)
- Draw request queue — approve/fund/decline with one click
- Document status tracker across all projects
- Lender and borrower directories

### Lender (`/lender`)
- Portfolio overview with LTV monitoring
- Per-loan draw progress and financials
- Approval queue with full draw details
- Document review for missing items

### Borrower (`/borrower`)
- Dashboard with available funds by project
- Submit draw requests with file uploads
- Document checklist with upload capability
- Real-time status on pending draws

---

## Email Notifications (Optional)

1. Create account at [resend.com](https://resend.com) (free tier: 3,000 emails/month)
2. Add your sending domain (or use `onboarding@resend.dev` for testing)
3. Add `RESEND_API_KEY` to Vercel environment variables
4. Notifications trigger automatically via Supabase DB triggers on:
   - Draw submitted → lender notified
   - Draw funded/declined → borrower notified

---

## Custom Domain

In Vercel → Project Settings → Domains:
- Add `app.buildchainprotocol.com` or similar
- Update Supabase Site URL to match

---

## Project Structure

```
buildchain-app/
├── app/
│   ├── (auth)/login        # Login page
│   ├── (auth)/signup       # Signup page
│   ├── (dashboard)/
│   │   ├── admin/          # Admin dashboards
│   │   ├── lender/         # Lender dashboards
│   │   └── borrower/       # Borrower dashboards
│   ├── api/                # REST API routes
│   └── layout.tsx
├── components/
│   ├── shared/             # Topbar, Sidebar
│   └── ui/                 # StatCard, Badge, ProgressBar
├── lib/
│   ├── supabase/           # Client + server Supabase helpers
│   ├── types/              # TypeScript types (database.ts)
│   └── utils.ts            # Formatting helpers
├── supabase/
│   ├── migrations/         # SQL schema files
│   └── seed.sql            # Sample data
├── middleware.ts            # Auth + role-based routing
└── SETUP.md                # This file
```

---

## Support

Built by BuildChain Protocol. Questions: info@buildchain.finance
