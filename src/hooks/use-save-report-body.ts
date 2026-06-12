// src/hooks/use-save-report-body.ts
'use client';

import { useMutation } from '@tanstack/react-query';
import { useToastStore } from '@/components/toast/toast-store';

interface SaveBodyVars {
  filename: string;
  body: string;
}

async function saveBody({ filename, body }: SaveBodyVars): Promise<void> {
  const res = await fetch(`/api/reports/${encodeURIComponent(filename)}/body`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Save failed (HTTP ${res.status})`);
}

export function useSaveReportBody() {
  const push = useToastStore(s => s.push);
  return useMutation({
    mutationFn: saveBody,
    onError: err => push('danger', err instanceof Error ? err.message : 'Save failed'),
  });
}
