import { assignmentBadge, inferMachineMode, machineTagOf, type CartMachineItem } from '@/lib/lgThinq';

export const printDirectThermal = async (receiptData: {
    storeName: string;
    receiptNo: string;
    customerName: string;
    items: Array<{ name: string; qty: number; price: number }>;
    total: number;
  }) => {
    try {
      // Membuka koneksi Web Serial API / Direct Print Stream
      if ('serial' in navigator) {
        const port = await (navigator as any).serial.requestPort();
        await port.open({ baudRate: 9600 });
        const writer = port.writable.getWriter();
        const encoder = new TextEncoder();
  
        let text = `\x1B\x40`; // Reset printer ESC/POS
        text += `\x1B\x61\x01${receiptData.storeName}\n`; // Center text
        text += `--------------------------------\n`;
        text += `Nota: ${receiptData.receiptNo}\n`;
        text += `Pelanggan: ${receiptData.customerName}\n`;
        text += `--------------------------------\n`;
        
        receiptData.items.forEach(item => {
          text += `${item.name} x${item.qty} = Rp ${(item.qty * item.price).toLocaleString('id-ID')}\n`;
        });
  
        text += `--------------------------------\n`;
        text += `TOTAL: Rp ${receiptData.total.toLocaleString('id-ID')}\n\n\n\n`;
        text += `\x1D\x56\x41`; // Cut paper command
  
        await writer.write(encoder.encode(text));
        writer.releaseLock();
        return true;
      } else {
        window.print(); // Fallback standar browser print
      }
    } catch (err) {
      window.print(); // Fallback jika port serial ditolak
    }
  };

export type BagSticker = {
  receipt: string;
  bagIndex: number;
  totalBags: number;
  customerName: string;
  service: string;
  machineTag: string;
};

export function buildBagStickers(
  orderId: string,
  totalBags: number,
  items: CartMachineItem[],
  meta?: { receipt?: string; customerName?: string }
): BagSticker[] {
  const n = Math.max(1, Number(totalBags) || items?.length || 1);
  const receipt = String(meta?.receipt || orderId || 'ORD');
  const customer = String(meta?.customerName || 'Pelanggan');
  return Array.from({ length: n }, (_, i) => {
    const item = (items?.[i] || items?.[0] || {}) as CartMachineItem;
    const mode = inferMachineMode(item);
    return {
      receipt,
      bagIndex: i + 1,
      totalBags: n,
      customerName: customer,
      service: assignmentBadge(item, i + 1),
      machineTag: String((item as any).machineTag || machineTagOf(mode))
    };
  });
}

/** Loop thermal sticker per kantong fisik: [ORD-XXXX] | KANTONG X DARI Y | Nama | Service / Batch. */
export async function printBagStickers(
  orderId: string,
  totalBags: number,
  items: CartMachineItem[],
  meta?: { receipt?: string; customerName?: string; storeName?: string }
) {
  const stickers = buildBagStickers(orderId, totalBags, items, meta);
  try {
    if ('serial' in navigator) {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600 });
      const writer = port.writable.getWriter();
      const encoder = new TextEncoder();
      let text = `\x1B\x40`;
      stickers.forEach((s) => {
        text += `\x1B\x61\x01`;
        text += `[${s.receipt}]\n`;
        text += `KANTONG ${s.bagIndex} DARI ${s.totalBags}\n`;
        text += `${s.customerName}\n`;
        text += `${s.service} / ${s.machineTag}\n`;
        text += `--------------------------------\n\n`;
        text += `\x1D\x56\x41`;
      });
      await writer.write(encoder.encode(text));
      writer.releaseLock();
      return stickers;
    }
  } catch {
    /* browser print fallback */
  }
  window.print();
  return stickers;
}