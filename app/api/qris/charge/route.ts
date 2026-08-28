import { NextResponse } from 'next/server';
import Xendit from 'xendit-node';

export async function POST(req: Request) {
  try {
    const xenditSecretKey = process.env.XENDIT_SECRET_KEY;
    if (!xenditSecretKey || !xenditSecretKey.startsWith('xnd_')) {
      return NextResponse.json({ error: 'Xendit Secret Key belum dikonfigurasi di environment variable (.env.local)' }, { status: 500 });
    }

    const xenditClient = new Xendit({ secretKey: xenditSecretKey });
    const body = await req.json();
    const { amount, customerName, customerPhone, orderId, description, type } = body;

    if (!amount || amount < 1000) {
      return NextResponse.json({ error: 'Nominal pembayaran minimal Rp 1.000' }, { status: 400 });
    }

    const externalId = `TRX-${orderId || Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const invoiceResponse = await xenditClient.Invoice.createInvoice({
      data: {
        externalId: externalId,
        amount: Number(amount),
        description: description || `Pembayaran Laundry - ${customerName}`,
        customer: {
          givenNames: customerName || 'Pelanggan Laundry',
          mobileNumber: customerPhone || '08123456789',
        },
        successRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/customer/dashboard?payment=success`,
        failureRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/customer/dashboard?payment=failed`,
        currency: 'IDR',
        metadata: {
          type: type || 'deposit',
          customerPhone: customerPhone,
        }
      }
    });

    return NextResponse.json({
      success: true,
      invoiceUrl: invoiceResponse.invoiceUrl,
      externalId: invoiceResponse.externalId,
      id: invoiceResponse.id
    });

  } catch (error: any) {
    console.error('Error creating Xendit Invoice:', error);
    return NextResponse.json(
      { error: error?.message || 'Gagal memproses pembayaran ke Xendit' },
      { status: 500 }
    );
  }
}