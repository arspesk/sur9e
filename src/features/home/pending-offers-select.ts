// Pure selector: "pending offers" = screened or evaluated rows (not yet
// applied), highest score first. Isomorphic — the Home RSC calls it with
// server rows; tests call it directly.

export interface PendingOfferSource {
  num: number;
  company: string;
  role: string;
  score: string;
  status: string;
  reportPath: string | null;
  companyLogo: string | null;
}

export interface PendingOffer extends PendingOfferSource {
  status: 'screened' | 'evaluated';
}

const PENDING = new Set(['screened', 'evaluated']);

function scoreValue(score: string): number {
  const n = Number.parseFloat(score);
  return Number.isNaN(n) ? -1 : n; // 'N/A' / '-' sink below every real score
}

export function selectPendingOffers(entries: PendingOfferSource[], limit = 6): PendingOffer[] {
  return entries
    .filter(e => PENDING.has(e.status.trim().toLowerCase()))
    .map(e => ({ ...e, status: e.status.trim().toLowerCase() as PendingOffer['status'] }))
    .sort((a, b) => scoreValue(b.score) - scoreValue(a.score))
    .slice(0, limit);
}
