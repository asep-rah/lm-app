import { POST as handleMayarWebhook } from '@/app/api/webhooks/mayar/route';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleMayarWebhook(req);
}
