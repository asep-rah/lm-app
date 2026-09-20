-- ============================================================================
-- Pengajuan pembelian: Admin Ops menjadi gerbang verifikasi, OWNER yang membayar.
-- Lihat docs/BUSINESS_RULES.md §18 (disetujui 2026-09-20).
--
-- Alur baru:
--   'Pending Approval'               kepala toko / kasir mengajukan
--   'Approved - Awaiting Admin Ops'  supervisor menyetujui           (status lama)
--   'Needs Revision'                 Admin Ops kembalikan            (BARU)
--   'Awaiting Owner Payment'         Admin Ops verifikasi & teruskan (BARU)
--   'Paid'                           owner membayar -> catat expenses (aktor berubah)
--   'Rejected'                       ditolak                         (status lama)
--
-- Status 'Paid' sengaja dipertahankan supaya isPrPaid() dan laporan finance yang
-- sudah ada tidak berubah perilakunya. Yang berubah adalah SIAPA yang men-set.
--
-- RISIKO L4 (docs/PRD.md §10): menyentuh pencatatan uang. Butuh review manusia.
-- ============================================================================

alter table purchase_requests
  -- Jejak verifikasi Admin Ops
  add column if not exists verified_by_name   text,
  add column if not exists verified_at        timestamptz,
  -- Pengembalian ke pemohon
  add column if not exists revision_reason    text,
  -- Ditandai Admin Ops saat pengajuan ini dinilai kembaran dari pengajuan lain
  add column if not exists duplicate_of_id    uuid,
  -- Bukti transfer diunggah Admin Ops SETELAH owner membayar; lihat §18 butir 7
  add column if not exists proof_uploaded_by  text,
  add column if not exists proof_uploaded_at  timestamptz;

create index if not exists idx_purchase_requests_verified
  on purchase_requests (verified_at desc);

-- ---------------------------------------------------------------------------
-- Satu pengajuan tidak boleh melahirkan dua biaya.
--
-- Sebelum 2026-09-20, components/RequisitionForm.tsx menyisipkan baris expenses
-- lalu memperbarui status tanpa pengaman: bila insert berhasil tapi update gagal,
-- menekan tombol lagi membuat biaya kedua. Indeks ini menutup celah itu di level
-- database, bukan di UI.
--
-- Bila data lama sudah mengandung biaya ganda, migrasi ini BERHENTI dengan pesan
-- yang bisa ditindaklanjuti -- lebih baik gagal jelas daripada indeks dibuat
-- separuh jalan atau, lebih buruk, duplikat dibiarkan.
-- ---------------------------------------------------------------------------
do $$
declare
  dup_groups int;
  dup_sample text;
begin
  select count(*), string_agg(requisition_id::text || ' (' || n || 'x)', ', ')
    into dup_groups, dup_sample
  from (
    select requisition_id, count(*) as n
    from expenses
    where requisition_id is not null
    group by requisition_id
    having count(*) > 1
    limit 20
  ) d;

  if coalesce(dup_groups, 0) > 0 then
    raise exception
      'Ada % pengajuan dengan biaya ganda di expenses. Bersihkan dulu sebelum indeks unik dipasang. Contoh requisition_id: %',
      dup_groups, dup_sample;
  end if;

  create unique index if not exists expenses_requisition_uniq
    on expenses (requisition_id)
    where requisition_id is not null;
end $$;
