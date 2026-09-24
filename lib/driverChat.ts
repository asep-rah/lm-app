/**
 * In-app chat between the assigned driver and the customer of ONE pickup
 * order (like Grab/Gojek): open while the driver is on the way / carrying the
 * laundry, read-only afterwards.
 *
 * Pure rules (browser + server). Storage is the service-role-only table
 * public.order_driver_chats, reached only through
 * /api/customer/driver-chat and /api/staff/driver-chat.
 */

/** Order statuses in which the driver and the customer can write. */
export const DRIVER_CHAT_OPEN_STATUSES = ['Driver Menuju Lokasi', 'Barang Dibawa ke Outlet', 'Driver Mengantar'] as const;

export const DRIVER_CHAT_MAX_LENGTH = 1000;

export type DriverChatSender = 'driver' | 'customer';

export type DriverChatMessage = {
  id: string;
  sender_type: DriverChatSender;
  sender_name: string | null;
  message: string;
  created_at: string;
  read_at: string | null;
};

type OrderLike = { status?: unknown; driver_name?: unknown } | null | undefined;

export const driverNameOf = (order: OrderLike) => String(order?.driver_name ?? '').trim();

/** A driver has taken the order and the trip is still running. */
export const isDriverChatOpen = (order: OrderLike): boolean =>
  Boolean(driverNameOf(order)) && (DRIVER_CHAT_OPEN_STATUSES as readonly string[]).includes(String(order?.status ?? ''));

/** Same driver (orders store the driver's display name, not an id). */
export const sameDriverName = (a: unknown, b: unknown) => {
  const x = String(a ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return Boolean(x) && x === String(b ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
};

/** Message text: control characters removed (newlines kept), trimmed, bounded. '' when empty. */
export const cleanDriverChatText = (v: unknown): string =>
  String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, DRIVER_CHAT_MAX_LENGTH);
