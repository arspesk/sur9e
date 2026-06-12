import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanyAvatar } from '../company-avatar';

// The logo img is decorative (alt="", no role) — the surrounding link's
// aria-label / the static wrapper's aria-hidden carry the semantics — so
// these tests query the element directly instead of by ARIA role.
describe('CompanyAvatar', () => {
  it('renders the logo img when a url is provided', () => {
    const { container } = render(
      <CompanyAvatar company="Otter" logoUrl="https://logo.clearbit.com/tryotter.com" />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', expect.stringContaining('tryotter.com'));
  });
  it('renders the initial when no logo url', () => {
    render(<CompanyAvatar company="Otter" />);
    expect(screen.getByText('O')).toBeInTheDocument();
  });
  it('falls back to the initial when the image errors', () => {
    const { container } = render(
      <CompanyAvatar company="Otter" logoUrl="https://broken.example/x.png" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    if (img) fireEvent.error(img);
    expect(screen.getByText('O')).toBeInTheDocument();
  });
});

// Derived Google-favicon URLs (minted by batch/screen.mjs) must NOT mount an
// <img> directly — every cross-origin 404 logs a console error, so they go
// through the same-origin /api/favicon probe: 200+image/* mounts the blob,
// 204 (miss) stays on the initial silently. The probe memoizes per domain,
// so each case below uses a unique domain to dodge the module-level cache.
describe('CompanyAvatar derived-favicon probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function derivedUrl(domain: string): string {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  }

  it('mounts the proxied image when the probe resolves with image bytes', async () => {
    // A plain response stub, not `new Response(new Blob(...))`: wrapping a
    // jsdom Blob in an undici Response makes `.blob()` call `.stream()` on the
    // jsdom Blob, which throws on Node 22 ("object.stream is not a function").
    // The component only reads `.ok`, `.headers.get()`, and `.blob()`.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/png' : null),
        },
        blob: async () => new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' }),
      }),
    );
    const objectUrl = 'blob:fake-favicon-hit';
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn().mockReturnValue(objectUrl);
        static revokeObjectURL = vi.fn();
      },
    );

    const { container } = render(
      <CompanyAvatar company="Hit" logoUrl={derivedUrl('probe-hit.example')} />,
    );
    // Initial fallback shows while the probe is in flight.
    expect(screen.getByText('H')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('img')).toHaveAttribute('src', objectUrl);
    });
    expect(fetch).toHaveBeenCalledWith('/api/favicon?domain=probe-hit.example');
  });

  it('stays on the initial when the probe misses (204, no content-type)', async () => {
    const miss = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', miss);

    const { container } = render(
      <CompanyAvatar company="Miss" logoUrl={derivedUrl('probe-miss.example')} />,
    );
    await waitFor(() => expect(miss).toHaveBeenCalled());
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('stays on the initial when the probe fetch rejects (offline)', async () => {
    const reject = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', reject);

    const { container } = render(
      <CompanyAvatar company="Down" logoUrl={derivedUrl('probe-down.example')} />,
    );
    await waitFor(() => expect(reject).toHaveBeenCalled());
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('D')).toBeInTheDocument();
  });
});
