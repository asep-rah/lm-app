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