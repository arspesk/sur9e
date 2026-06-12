// src/stores/report-toc-store.ts
import { create } from 'zustand';
import type { TocItem } from '@/features/report/toc-items';

interface ReportTocStore {
  items: TocItem[];
  setItems: (items: TocItem[]) => void;
}

export const useReportTocStore = create<ReportTocStore>(set => ({
  items: [],
  setItems: items => set({ items }),
}));
