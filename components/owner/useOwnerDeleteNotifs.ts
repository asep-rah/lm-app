'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export function useOwnerDeleteNotifs(liveIds?: string[]) {
  const [fetchedIds, setFetchedIds] = useState<string[]>([]);
  const ids = liveIds ?? fetchedIds;
  const pendingCount = useMemo(() => ids.filter(Boolean).length, [ids]);

  useEffect(() => {
    if (liveIds !== undefined) return;
    let cancelled = false;
    supabase
      .from('transactions')
      .select('id')
      .eq('delete_requested', true)
      .then(({ data }) => {
        if (!cancelled) setFetchedIds((data || []).map((r: { id: string }) => String(r.id)));
      });
    return () => {
      cancelled = true;
    };
  }, [liveIds]);

  return { unread: pendingCount, pendingCount };
}
