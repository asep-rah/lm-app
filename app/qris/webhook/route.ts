import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://qlgbjvzabnfqmfnjdkmo.supabase.co',
  'sb_publishable_kDa38BSHh4SR6tMla6gphA_qiepy3Xs'
);

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    
    // Deteksi ID Transaksi (Resi) dari Xendit
    const referenceId = payload.data?.qr_code?.reference_id || payload.data?.reference_id || payload.reference_id;

    if (payload.event === 'qr.payment' && payload.data?.status === 'COMPLETED') {
      // Jika lunas, update transaksi di Supabase menjadi Diterima (Lunas)
      await supabase
        .from('transactions')
        .update({ status: 'Diterima' })
        .eq('receipt_number', referenceId);
    }

    return NextResponse.json({ status: 'OK' });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}