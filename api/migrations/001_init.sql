-- Elev8 Finance · schema v1
-- Every financial row carries user_id; every query filters by it.
-- IDs are 26-char random identifiers (not sequential). Money is integer cents (BIGINT).
-- Descriptions, merchants and notes are encrypted at rest by the API (libsodium); amounts stay plain so the server can sum them.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(32) PRIMARY KEY,
  applied_at  DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id               CHAR(26)     NOT NULL PRIMARY KEY,
  email            VARCHAR(190) NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  display_name     VARCHAR(80)  NULL,
  failed_logins    SMALLINT     NOT NULL DEFAULT 0,
  locked_until     DATETIME     NULL,
  created_at       DATETIME     NOT NULL,
  updated_at       DATETIME     NOT NULL,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id            CHAR(26)  NOT NULL PRIMARY KEY,
  user_id       CHAR(26)  NOT NULL,
  token_hash    CHAR(64)  NOT NULL,
  csrf_token    CHAR(64)  NOT NULL,
  device_label  VARCHAR(120) NULL,
  created_at    DATETIME  NOT NULL,
  last_seen_at  DATETIME  NOT NULL,
  expires_at    DATETIME  NOT NULL,
  revoked_at    DATETIME  NULL,
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY ix_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Login throttling by hashed IP and hashed e-mail (no raw IPs stored).
CREATE TABLE IF NOT EXISTS login_attempts (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  key_hash    CHAR(64)  NOT NULL,
  attempted_at DATETIME NOT NULL,
  KEY ix_attempts_key (key_hash, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accounts (
  id           CHAR(26)    NOT NULL PRIMARY KEY,
  user_id      CHAR(26)    NOT NULL,
  name         VARCHAR(60) NOT NULL,
  kind         ENUM('credit','debit','checking','cash') NOT NULL,
  closing_day  TINYINT     NULL,
  due_day      TINYINT     NULL,
  archived     TINYINT(1)  NOT NULL DEFAULT 0,
  sort_order   SMALLINT    NOT NULL DEFAULT 0,
  created_at   DATETIME    NOT NULL,
  updated_at   DATETIME    NOT NULL,
  KEY ix_accounts_user (user_id),
  CONSTRAINT fk_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- grp drives the 50/30/20 view: need, want, save. income and transfer are kept apart from spending.
CREATE TABLE IF NOT EXISTS categories (
  id          CHAR(26)    NOT NULL PRIMARY KEY,
  user_id     CHAR(26)    NOT NULL,
  name        VARCHAR(60) NOT NULL,
  grp         ENUM('need','want','save','income','transfer') NOT NULL,
  archived    TINYINT(1)  NOT NULL DEFAULT 0,
  sort_order  SMALLINT    NOT NULL DEFAULT 0,
  created_at  DATETIME    NOT NULL,
  updated_at  DATETIME    NOT NULL,
  KEY ix_categories_user (user_id),
  CONSTRAINT fk_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A purchase (compra-mãe): what the person did. One row per purchase, even when split in installments.
CREATE TABLE IF NOT EXISTS purchases (
  id                 CHAR(26)  NOT NULL PRIMARY KEY,
  user_id            CHAR(26)  NOT NULL,
  kind               ENUM('expense','income','saving','transfer','invoice_payment','refund','investment') NOT NULL,
  status             ENUM('draft','confirmed','pending','reimbursable','reimbursed','cancelled') NOT NULL,
  origin             ENUM('manual','text','voice','import') NOT NULL DEFAULT 'manual',
  total_cents        BIGINT    NOT NULL,
  currency           CHAR(3)   NOT NULL DEFAULT 'BRL',
  purchase_date      DATE      NOT NULL,
  account_id         CHAR(26)  NULL,
  category_id        CHAR(26)  NULL,
  installments_total TINYINT   NOT NULL DEFAULT 1,
  recurring          ENUM('none','monthly') NOT NULL DEFAULT 'none',
  description_enc    VARBINARY(1024) NULL,
  merchant_enc       VARBINARY(512)  NULL,
  merchant_key       CHAR(64)  NULL,
  notes_enc          VARBINARY(2048) NULL,
  tags_enc           VARBINARY(1024) NULL,
  idempotency_key    VARCHAR(64) NOT NULL,
  created_at         DATETIME  NOT NULL,
  updated_at         DATETIME  NOT NULL,
  UNIQUE KEY uq_purchases_idem (user_id, idempotency_key),
  KEY ix_purchases_user_date (user_id, purchase_date),
  CONSTRAINT fk_purchases_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_purchases_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_purchases_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per month the money counts in. A 6x purchase has 6 rows; a single purchase has 1.
-- month = first day of the month the amount counts in (card: the invoice due month; others: the purchase month).
CREATE TABLE IF NOT EXISTS installments (
  id            CHAR(26)  NOT NULL PRIMARY KEY,
  user_id       CHAR(26)  NOT NULL,
  purchase_id   CHAR(26)  NOT NULL,
  seq           TINYINT   NOT NULL,
  amount_cents  BIGINT    NOT NULL,
  month         DATE      NOT NULL,
  status        ENUM('draft','confirmed','pending','reimbursable','reimbursed','cancelled') NOT NULL,
  created_at    DATETIME  NOT NULL,
  updated_at    DATETIME  NOT NULL,
  UNIQUE KEY uq_installments_seq (purchase_id, seq),
  KEY ix_installments_user_month (user_id, month),
  CONSTRAINT fk_installments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_installments_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS budgets (
  user_id       CHAR(26) NOT NULL,
  month         DATE     NOT NULL,
  amount_cents  BIGINT   NOT NULL,
  updated_at    DATETIME NOT NULL,
  PRIMARY KEY (user_id, month),
  CONSTRAINT fk_budgets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Category suggestions learn only from this user's own corrections, keyed by an HMAC of the merchant (no plain text).
CREATE TABLE IF NOT EXISTS merchant_rules (
  user_id      CHAR(26) NOT NULL,
  merchant_key CHAR(64) NOT NULL,
  category_id  CHAR(26) NOT NULL,
  hits         INT      NOT NULL DEFAULT 1,
  updated_at   DATETIME NOT NULL,
  PRIMARY KEY (user_id, merchant_key),
  CONSTRAINT fk_rules_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rules_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Technical audit trail: who did what to which record. Never amounts, descriptions or text.
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     CHAR(26)    NULL,
  action      VARCHAR(40) NOT NULL,
  entity      VARCHAR(30) NULL,
  entity_id   CHAR(26)    NULL,
  created_at  DATETIME    NOT NULL,
  KEY ix_audit_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
