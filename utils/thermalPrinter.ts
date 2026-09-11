import { assignmentBadge, encodeBagQr, inferMachineMode, machineTagOf, type CartMachineItem } from '@/lib/lgThinq';

export const printDirectThermal = async (receiptData: {
  storeName: string;
  receiptNo: string;
  customerName: string;
  items: Array<{ name: string; qty: number; price: number }>;
  total: number;
}) => {
  try {
    if ('serial' in navigator && !isMobileBrowser()) {
      const port = await openSerialPort();
      if (!port) {
        window.print();
        return false;
      }
      await port.open({ baudRate: 9600 });
      const writer = port.writable.getWriter();
      const encoder = new TextEncoder();

      let text = `\x1B\x40`;
      text += `\x1B\x61\x01${receiptData.storeName}\n`;
      text += `--------------------------------\n`;
      text += `Nota: ${receiptData.receiptNo}\n`;
      text += `Pelanggan: ${receiptData.customerName}\n`;
      text += `--------------------------------\n`;

      receiptData.items.forEach((item) => {
        text += `${item.name} x${item.qty} = Rp ${(item.qty * item.price).toLocaleString('id-ID')}\n`;
      });

      text += `--------------------------------\n`;
      text += `TOTAL: Rp ${receiptData.total.toLocaleString('id-ID')}\n\n\n\n`;
      text += `\x1D\x56\x41`;

      await writer.write(encoder.encode(text));
      writer.releaseLock();
      return true;
    }
    window.print();
  } catch {
    window.print();
  }
  return false;
};

export type BagSticker = {
  receipt: string;
  bagIndex: number;
  totalBags: number;
  customerName: string;
  service: string;
  machineTag: string;
  qrPayload?: string;
  washerId?: string;
  washerName?: string;
  orderId?: string;
};

export function buildBagStickers(
  orderId: string,
  totalBags: number,
  items: CartMachineItem[],
  meta?: { receipt?: string; customerName?: string; orderId?: string; cycles?: any[] }
): BagSticker[] {
  const n = Math.max(1, Number(totalBags) || items?.length || 1);
  const receipt = String(meta?.receipt || orderId || 'ORD');
  const customer = String(meta?.customerName || 'Pelanggan');
  const uuid = String(meta?.orderId || (/^[0-9a-f-]{36}$/i.test(orderId) ? orderId : ''));
  return Array.from({ length: n }, (_, i) => {
    const item = (items?.[i] || items?.[0] || {}) as CartMachineItem;
    const cycle = meta?.cycles?.[i] || meta?.cycles?.find((c: any) => Number(c.batch_index) === i + 1);
    const mode = inferMachineMode(item);
    const washerId = String(item.washerId || cycle?.washer_id || '');
    const washerName = String(item.washerName || cycle?.machine_tag || '');
    return {
      receipt,
      bagIndex: i + 1,
      totalBags: n,
      customerName: customer,
      service: assignmentBadge(item, i + 1),
      machineTag: String((item as any).machineTag || machineTagOf(mode)),
      qrPayload: encodeBagQr({ orderId: uuid || orderId, washerId, bagIndex: i + 1, receipt }),
      washerId,
      washerName,
      orderId: uuid || orderId
    };
  });
}

function isMobileBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

async function openSerialPort(): Promise<any | null> {
  const serial = (navigator as any).serial;
  if (!serial) return null;
  try {
    const existing = await serial.getPorts();
    if (existing?.length) return existing[0];
  } catch {
    /* ignore */
  }
  // Jangan paksa dialog port di HP / tablet — pakai cetak HTML.
  if (isMobileBrowser()) return null;
  try {
    return await serial.requestPort();
  } catch {
    return null;
  }
}

/**
 * Coba thermal serial; jika gagal/tidak tersedia kembalikan stickers
 * tanpa memanggil window.print (caller yang set printMode dulu).
 */
export async function printBagStickers(
  orderId: string,
  totalBags: number,
  items: CartMachineItem[],
  meta?: { receipt?: string; customerName?: string; storeName?: string; orderId?: string; cycles?: any[] }
): Promise<{ stickers: BagSticker[]; printedViaSerial: boolean }> {
  const stickers = buildBagStickers(orderId, totalBags, items, meta);
  try {
    if ('serial' in navigator) {
      const port = await openSerialPort();
      if (port) {
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
          if (s.qrPayload) text += `QR ${s.qrPayload}\n`;
          text += `--------------------------------\n\n`;
          text += `\x1D\x56\x41`;
        });
        await writer.write(encoder.encode(text));
        writer.releaseLock();
        try {
          await port.close();
        } catch {
          /* ignore */
        }
        return { stickers, printedViaSerial: true };
      }
    }
  } catch {
    /* browser print fallback via caller */
  }
  return { stickers, printedViaSerial: false };
}
