-- Menambah 6 kolom detail cucian ke pickup_orders.
-- Sebelumnya data ini digabung sebagai teks di dalam kolom `notes`, sehingga
-- form POS tidak bisa mengisinya otomatis lewat select('*').

alter table pickup_orders
  add column if not exists address        text,
  add column if not exists duration       text    default 'Reguler (3 Hari)',
  add column if not exists bag_count      integer default 1,
  add column if not exists wash_process   text    default 'Pisah',
  add column if not exists has_fading     boolean default false,
  add column if not exists has_valuables  boolean default false;

-- Backfill data lama: ekstrak nilai dari pola
-- "[INFO CUCIAN] Kantong: X | Cuci: Y | Luntur: Ya/Tidak | Brg Berharga: Ya/Tidak | Alamat: Z"
update pickup_orders
set
  bag_count = coalesce(
    nullif(regexp_replace(substring(notes from 'Kantong:\s*([^|]*)'), '\D', '', 'g'), '')::integer,
    1
  ),
  wash_process  = coalesce(nullif(btrim(substring(notes from 'Cuci:\s*([^|]*)')), ''), 'Pisah'),
  has_fading    = substring(notes from 'Luntur:\s*([^|]*)')       ilike '%ya%',
  has_valuables = substring(notes from 'Brg Berharga:\s*([^|]*)') ilike '%ya%',
  address       = coalesce(nullif(btrim(substring(notes from 'Alamat:\s*([^|]*)')), ''), '')
where notes like '%[INFO CUCIAN]%'
  and address is null;
