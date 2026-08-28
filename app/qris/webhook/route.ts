import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Menggunakan fallback string agar Next.js tidak crash saat proses build
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabase = createClient(supabaseUrl, supabaseKey);

export const dynamic = 'force-dynamic';
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