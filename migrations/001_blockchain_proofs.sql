-- Backs PostgresBlockchainProofStore (src/services/PostgresBlockchainProofStore.ts).
-- One table: this is the persistent version of what InMemoryBlockchainProofStore
-- held in a Map — the "Blockchain Sync" storage requirement from the
-- production diagram.

CREATE TABLE IF NOT EXISTS blockchain_proofs (
  asset_id               TEXT PRIMARY KEY,
  asset_hash             TEXT NOT NULL,
  analysis_hash          TEXT NOT NULL,
  copy_score             SMALLINT NOT NULL CHECK (copy_score >= 0 AND copy_score <= 100),
  analysis_version       TEXT NOT NULL,
  analysis_version_hash  TEXT NOT NULL,
  chain_id               INTEGER NOT NULL,
  schema_uid             TEXT NOT NULL,
  attestation_uid        TEXT,
  transaction_hash       TEXT,
  attester               TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('PENDING','SUBMITTED','CONFIRMED','FAILED','REVOKED')),
  "timestamp"             BIGINT,
  ref_uid                 TEXT,
  idempotency_key         TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backs BlockchainProofStore.findByIdempotencyKey — this is on the hot
-- path (checked on every createBlockchainProof call), needs to be fast.
CREATE INDEX IF NOT EXISTS idx_blockchain_proofs_idempotency_key
  ON blockchain_proofs (idempotency_key);

-- Backs BlockchainSyncService-style queries: "find everything still
-- PENDING/SUBMITTED so I can reconcile it" — not built yet, but this
-- index is cheap to add now and expensive to add later on a large table.
CREATE INDEX IF NOT EXISTS idx_blockchain_proofs_status
  ON blockchain_proofs (status);
