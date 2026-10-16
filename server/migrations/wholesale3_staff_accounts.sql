-- Staff accounts: a wholesaler's employees, working on his book.
--
-- Until now every employee used the owner's own login. Nothing in any history
-- could say who actually did a thing, and an owner could not take access back
-- from somebody who had left without changing his own password and telling
-- everybody else the new one.
--
-- One row per employment, not per person. The person is a normal user in
-- `users` and signs in the ordinary way. This table is what points his session
-- at his employer's customers, sales and stock instead of at an empty book of
-- his own.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS staff_members (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The owner whose book this person works on.
    wholesaler_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The person. Null until the invite is accepted, because an owner adds his
    -- nephew before his nephew has an account.
    user_id        UUID REFERENCES users(id) ON DELETE CASCADE,

    name           VARCHAR(120) NOT NULL,
    phone          VARCHAR(20),
    email          VARCHAR(255),

    -- What he may do. Checked against the catalogue in services/staffAccess,
    -- which is the authority. The column is deliberately not an enum array,
    -- because adding a permission should not need a migration.
    permissions    TEXT[] NOT NULL DEFAULT '{}',

    -- invited  added, has not signed in yet
    -- active   working
    -- disabled turned off, history kept. Never deleted: his name is on
    --          dispatches and payments, and those must still read right.
    status         VARCHAR(20) NOT NULL DEFAULT 'invited'
                   CHECK (status IN ('invited', 'active', 'disabled')),

    -- The invite. The code is the credential, so it is random, single use and
    -- expires. Cleared once accepted.
    invite_code       VARCHAR(64) UNIQUE,
    invite_expires_at TIMESTAMP,

    invited_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    joined_at      TIMESTAMP,
    last_seen_at   TIMESTAMP,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One person works for one wholesaler at a time. Partial, so the many rows
-- still waiting on an invite (user_id IS NULL) do not collide with each other,
-- and a disabled row does not block re-hiring somebody later.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_one_employer
    ON staff_members (user_id)
    WHERE user_id IS NOT NULL AND status <> 'disabled';

-- The owner's staff page, and the lookup on every request an employee makes.
CREATE INDEX IF NOT EXISTS idx_staff_wholesaler ON staff_members (wholesaler_id);
CREATE INDEX IF NOT EXISTS idx_staff_user       ON staff_members (user_id);

-- An owner cannot employ himself. Without this an accidental self invite would
-- make his own session resolve through the staff path and lose him the
-- owner-only screens.
ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS chk_staff_not_self;
ALTER TABLE staff_members ADD CONSTRAINT chk_staff_not_self
    CHECK (user_id IS NULL OR user_id <> wholesaler_id);

COMMENT ON TABLE  staff_members IS 'Employees who work on a wholesaler''s book. One row per employment.';
COMMENT ON COLUMN staff_members.permissions IS 'Subset of services/staffAccess PERMISSION_KEYS. Owner-only actions are not in it and cannot be granted.';
COMMENT ON COLUMN staff_members.status IS 'invited, active, or disabled. Rows are disabled rather than deleted so past history still reads correctly.';
