-- PUBLIVRA AI: SIMPLE AUTHORIZATION SYSTEM
--
-- REFERENCE COPY. This schema is ALREADY APPLIED to the Neon database.
-- Do NOT run it again there. It is kept here so the tests can build a scratch copy
-- of the tables (in a temporary schema) and so the code and schema can be read together.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Companies
CREATE TABLE auth_companies (
    company_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(200) NOT NULL,
    company_email VARCHAR(255) NOT NULL,
    company_domain VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users
CREATE TABLE auth_users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_auth_users_email
ON auth_users (LOWER(email));

-- 3. Company memberships
CREATE TABLE auth_company_memberships (
    membership_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES auth_companies(company_id),
    user_id UUID NOT NULL REFERENCES auth_users(user_id),
    role VARCHAR(30) NOT NULL CHECK (
        role IN ('creator', 'manager', 'legal_approver')
    ),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(company_id, user_id),
    UNIQUE(company_id, role),
    UNIQUE(company_id, user_id)
);

-- 4. Exactly three role invitations per company
CREATE TABLE auth_invitations (
    invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES auth_companies(company_id),
    role VARCHAR(30) NOT NULL CHECK (
        role IN ('creator', 'manager', 'legal_approver')
    ),
    code_hash TEXT NOT NULL UNIQUE,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(company_id, role)
);

-- 5. Content
CREATE TABLE auth_content (
    content_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    creator_user_id UUID NOT NULL,
    title VARCHAR(300) NOT NULL,
    body TEXT NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN (
        'draft',
        'pending_manager',
        'pending_legal',
        'approved',
        'rejected',
        'changes_requested',
        'published'
    )),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    FOREIGN KEY (company_id, creator_user_id)
    REFERENCES auth_company_memberships(company_id, user_id)
);

CREATE INDEX idx_auth_content_company
ON auth_content(company_id, status);

-- 6. Approval records
CREATE TABLE auth_approval_records (
    approval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID NOT NULL REFERENCES auth_content(content_id),
    reviewer_user_id UUID NOT NULL REFERENCES auth_users(user_id),

    reviewer_role VARCHAR(30) NOT NULL CHECK (
        reviewer_role IN ('manager', 'legal_approver')
    ),

    decision VARCHAR(30) NOT NULL CHECK (
        decision IN (
            'approved',
            'sent_to_legal',
            'rejected',
            'changes_requested'
        )
    ),

    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auth_approvals_content
ON auth_approval_records(content_id);
