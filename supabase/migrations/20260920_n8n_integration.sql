-- ============================================================================
-- Permukaan integrasi n8n.
--
-- Endpoint masuk: /api/integrations/n8n/* (bearer N8N_SHARED_SECRET).
--
-- RISIKO L4: approval lewat WhatsApp menyentuh otorisasi. Pengamanannya ada di
-- tabel approval_tokens di bawah, bukan pada "balas YA".
-- ============================================================================

-- Nomor WhatsApp staf. Dipakai memverifikasi PENGIRIM balasan approval; tanpa
-- nomor terdaftar, balasan approval harus ditolak.
alter table employees
  add column if not exists whatsapp text;

-- ---------------------------------------------------------------------------
-- Token approval sekali pakai, berumur pendek.
--
-- Menyimpan HASH token, bukan tokennya. Kebocoran isi tabel ini tidak boleh
-- langsung bisa dipakai menyetujui apa pun.
-- ---------------------------------------------------------------------------
create table if not exists approval_tokens (
  id                  uuid primary key default gen_random_uuid(),
  -- sha256 dari token mentah
  token_hash          text not null unique,
  -- requisition_approval | ...
  purpose             text not null,
  entity_type         text not null,
  entity_id           text not null,
  -- Nomor yang berhak memakai token ini, sudah dinormalkan ke format 62xxx
  issued_to_phone     text not null,
  issued_to_name      text,
  expires_at          timestamptz not null,
  -- Sekali pakai: diisi saat token dikonsumsi
  used_at             timestamptz,
  used_by_phone       text,
  decision            text,
  created_at          timestamptz default now()
);

create index if not exists idx_approval_tokens_entity
  on approval_tokens (entity_type, entity_id, created_at desc);
create index if not exists idx_approval_tokens_expiry
  on approval_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- Token approval BUKAN data publik.
--
-- Sengaja tidak ada grant ke anon/authenticated: hanya service role (dipakai
-- route server) yang boleh menyentuhnya. Memberi anon akses baca ke tabel ini
-- sama dengan menyerahkan kemampuan menyetujui pengeluaran.
-- ---------------------------------------------------------------------------
alter table approval_tokens enable row level security;
revoke all on approval_tokens from anon, authenticated;
grant all on approval_tokens to service_role;
