-- Add loan-level XRPL NFT fields to projects.
--
-- Strategy: one NFT per loan (not per draw).
-- Minted at origination → represents the digital title.
-- Burned/transferred at completion → proof of payoff.
-- Draws use XRPL escrow TX hashes as their records (no extra NFT needed).
--
-- URI encodes JSON loan metadata. Once Pinata/IPFS is integrated,
-- update mintLoanNFT() to pin a loan summary document and set
-- URI = 'ipfs://{CID}' for true immutability.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS loan_nft_token_id  TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS loan_nft_mint_hash  TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS loan_nft_burn_hash  TEXT;  -- set on loan completion

CREATE INDEX IF NOT EXISTS idx_projects_loan_nft_token_id ON projects (loan_nft_token_id);
