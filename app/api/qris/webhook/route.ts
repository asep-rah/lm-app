import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const xenditCallbackToken = req.headers.get('x-callback-token');
    if (process.env.XENDIT_WEBHOOK_VERIFICATION_TOKEN && xenditCallbackToken !== process.env.XENDIT_WEBHOOK_VERIFICATION_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
    }

    const body = await req.json();
    const { status, amount, external_id, metadata } = body;

    if (status === 'PAID' || status === 'SETTLED' || body?.event === 'qr.payment') {
      const customerPhone = metadata?.customerPhone;
      const type = metadata?.type;
      const refId = external_id || body?.data?.qr_code?.reference_id || body?.data?.reference_id;

      if (type === 'deposit' && customerPhone) {
        const { data: customer } = await supabase
          .from('customers')
          .select('deposit_balance')
          .eq('phone', customerPhone)
          .single();

        const currentBalance = customer?.deposit_balance || 0;
        const newBalance = Number(currentBalance) + Number(amount || 0);

        await supabase
          .from('customers')
          .update({ deposit_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('phone', customerPhone);

        await supabase.from('membership_logs').insert([{
          customer_phone: customerPhone,
          amount: Number(amount || 0),
          type: 'topup_xendit',
          description: `Top-up Saldo via Xendit (${refId})`,
          created_at: new Date().toISOString()
        }]);
      } else if (refId) {
        await supabase
          .from('transactions')
          .update({ 
            status: 'Diterima',
            payment_status: 'Lunas',
            payment_method: 'Xendit Gateway',
            updated_at: new Date().toISOString()
          })
          .eq('receipt_number', refId);
      }
    }

    return NextResponse.json({ status: 'success', message: 'OK' });

  } catch (error: any) {
    console.error('Xendit Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}