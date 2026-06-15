-- Add XRPL NFT fields to draw_requests for on-chain paper trail.
-- Each draw approval mints an NFToken on the XRPL. The token ID and mint
-- transaction hash are stored here, creating an immutable link between
-- the platform record and the blockchain record.

ALTER TABLE draw_requests ADD COLUMN IF NOT EXISTS nft_token_id    TEXT;
ALTER TABLE draw_requests ADD COLUMN IF NOT EXISTS nft_mint_hash   TEXT;

-- Add XRP wallet address to borrowers and lenders so per-party escrow
-- routing works (instead of falling back to the platform default address).
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS xrp_address TEXT;
ALTER TABLE lenders   ADD COLUMN IF NOT EXISTS xrp_address TEXT;

-- Index for NFT lookups (e.g. viewing a draw by token ID)
CREATE INDEX IF NOT EXISTS idx_draw_requests_nft_token_id ON draw_requests (nft_token_id);
