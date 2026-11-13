-- PUBLIVRA AI: tables for sign-in and the approval workflow ("Start as company").
-- Run once in the Neon SQL editor. Safe to run again (IF NOT EXISTS everywhere).
--
-- The AI audit history tables (document_compliance, publications, audit_events) are NOT here:
-- the backend creates them itself when it starts (database.init_db).

-- 1. Companies
CREATE TABLE IF NOT EXISTS auth_companies (
    company_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name   VARCHAR(200) NOT NULL,
    company_email  VARCHAR(255) NOT NULL,
    company_domain VARCHAR(255),
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_companies_domain ON auth_companies (LOWER(company_domain));

-- 2. Users (one login per person; the login ID is stored in `email`)
CREATE TABLE IF NOT EXISTS auth_users (
    user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name     VARCHAR(150) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_users_email ON auth_users (LOWER(email));

-- 3. Memberships: exactly one creator, one manager and one legal approver per company
CREATE TABLE IF NOT EXISTS auth_company_memberships (
    membership_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID NOT NULL REFERENCES auth_companies(company_id),
    user_id       UUID NOT NULL REFERENCES auth_users(user_id),
    role          VARCHAR(30) NOT NULL CHECK (role IN ('creator', 'manager', 'legal_approver')),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, user_id),
    UNIQUE (company_id, role)
);

-- 4. Content (every item belongs to one company and its creator)
CREATE TABLE IF NOT EXISTS auth_content (
    content_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    creator_user_id UUID NOT NULL,
    title           VARCHAR(300) NOT NULL,
    body            TEXT NOT NULL,
    status          VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN (
                        'draft', 'pending_manager', 'pending_legal', 'approved',
                        'rejected', 'changes_requested', 'published')),
    audit           JSONB,  -- creator's audit summary shown to reviewers (scores, findings, image / video checks)
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (company_id, creator_user_id) REFERENCES auth_company_memberships(company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_auth_content_company ON auth_content (company_id, status);

-- 5. Approval records (manager / legal decisions with comments)
CREATE TABLE IF NOT EXISTS auth_approval_records (
    approval_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id       UUID NOT NULL REFERENCES auth_content(content_id),
    reviewer_user_id UUID NOT NULL REFERENCES auth_users(user_id),
    reviewer_role    VARCHAR(30) NOT NULL CHECK (reviewer_role IN ('manager', 'legal_approver')),
    decision         VARCHAR(30) NOT NULL CHECK (decision IN ('approved', 'sent_to_legal', 'rejected', 'changes_requested')),
    comments         TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_approvals_content ON auth_approval_records (content_id);
