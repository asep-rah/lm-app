import { redirect } from 'next/navigation';

export default function CustomerHistoryRedirect() {
  redirect('/customer/activity?tab=riwayat');
}
