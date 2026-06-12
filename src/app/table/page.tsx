import { redirect } from 'next/navigation';

interface PageProps {
  searchParams?: Promise<Record<string, string>>;
}

// /table → /offers (table is the default view). Preserve any query string
// so deep links with filters keep working.
export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const qs = new URLSearchParams(params).toString();
  redirect(qs ? `/offers?${qs}` : '/offers');
}
