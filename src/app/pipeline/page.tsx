import { redirect } from 'next/navigation';

interface PageProps {
  searchParams?: Promise<Record<string, string>>;
}

// /pipeline → /offers?view=kanban. Preserve any other query string so
// deep links with filters keep working.
export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const qs = new URLSearchParams({ ...params, view: 'kanban' }).toString();
  redirect(`/offers?${qs}`);
}
