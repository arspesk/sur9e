export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { isValidFaviconDomain, loadFavicon } from '@/lib/server/favicon';

// Same-origin favicon proxy for CompanyAvatar. Hit → 200 + image bytes;
// miss → 204 (NOT 404: the browser logs a console error for every 4xx a
// fetch()/<img> touches, and silencing that noise is this route's whole job).
export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain');
  if (!domain) return jsonError('domain query param is required', 400);
  if (!isValidFaviconDomain(domain)) {
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  }
  const icon = await loadFavicon(domain);
  if (!icon) {
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  }
  return new Response(icon.bytes, {
    headers: {
      'Content-Type': icon.contentType,
      'Cache-Control': 'public, max-age=604800',
    },
  });
}
