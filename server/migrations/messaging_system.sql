-- =====================================================
-- MESSAGING SYSTEM
-- Backing table for buyer <-> supplier direct messaging.
-- The messages router and the Socket.IO handler both read
-- and write this table, so it must exist for chat to work.
-- =====================================================

-- users(id) is UUID in this database, so the participant columns are UUID too.
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_text TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fast lookup of a conversation between two users (either direction)
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_sender ON messages(receiver_id, sender_id);
-- Unread badge counts filter on receiver + is_read
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON messages(receiver_id) WHERE is_read = FALSE;
-- Conversations are ordered by created_at
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

COMMENT ON TABLE messages IS 'Direct messages exchanged between users';
COMMENT ON COLUMN messages.sender_id IS 'User who sent the message';
COMMENT ON COLUMN messages.receiver_id IS 'User who receives the message';
COMMENT ON COLUMN messages.message_text IS 'Message body';
COMMENT ON COLUMN messages.is_read IS 'Whether the receiver has read the message';
