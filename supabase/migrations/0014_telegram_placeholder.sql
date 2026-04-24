-- Tracks the Telegram message_id of the "thinking…" placeholder bubble
-- the webhook sends the moment an inbound message lands.
--
-- Lets telegram_reply (MCP tool) edit that placeholder in place instead
-- of posting a fresh bubble underneath it — so the user sees a single
-- bubble that animates through "Thinking…" → real reply.

alter table rgaios_telegram_messages
  add column if not exists placeholder_message_id bigint;
