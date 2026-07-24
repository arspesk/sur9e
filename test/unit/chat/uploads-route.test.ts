// @vitest-environment node
//
// test/unit/chat/uploads-route.test.ts
//
// Route-level coverage for POST /api/chat/uploads (multipart validation:
// unknown session, bad extension, oversize, file-count bounds) and
// GET /api/chat/uploads/[conversationId]/[file] (byte serving + the
// traversal guard). Pattern B (see turns-route.test.ts): tmpdir +
// SUR9E_ROOT + vi.resetModules() + dynamic import so the routes' module-
// level ROOT binding points at this test's throwaway root, never the repo.

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type UploadsRoute = typeof import('@/app/api/chat/uploads/route');
type ServeRoute = typeof import('@/app/api/chat/uploads/[conversationId]/[file]/route');
type ChatStore = typeof import('@/lib/server/chat/store');
type ChatDb = typeof import('@/lib/server/chat/db');

let root: string;
let uploadsRoute: UploadsRoute;
let serveRoute: ServeRoute;
let store: ChatStore;
let db: ChatDb;

async function loadRoot(): Promise<void> {
  root = mkdtempSync(join(tmpdir(), 'chat-uploads-route-'));
  process.env.SUR9E_ROOT = root;
  vi.resetModules();
  uploadsRoute = await import('@/app/api/chat/uploads/route');
  serveRoute = await import('@/app/api/chat/uploads/[conversationId]/[file]/route');
  store = await import('@/lib/server/chat/store');
  db = await import('@/lib/server/chat/db');
}

afterEach(() => {
  db.closeChatDb(root);
  rmSync(root, { recursive: true, force: true });
  delete process.env.SUR9E_ROOT;
});

/** Hand-rolled multipart body — deterministic, no jsdom-FormData interop. */
function multipartRequest(
  conversationId: string,
  files: Array<{ name: string; type: string; data: Uint8Array }>,
): Request {
  const boundary = '----sur9e-test-boundary';
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="conversationId"\r\n\r\n${conversationId}\r\n`,
    ),
  ];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="files"; filename="${f.name}"\r\ncontent-type: ${f.type}\r\n\r\n`,
      ),
      Buffer.from(f.data),
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return new Request('http://localhost/api/chat/uploads', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(parts),
  });
}

const png = (name = 'shot.png') => ({ name, type: 'image/png', data: new Uint8Array([1, 2, 3]) });

describe('POST /api/chat/uploads', () => {
  it('saves allowed files under the temp root and answers 201 with metadata', async () => {
    await loadRoot();
    const conv = store.createConversation(root);
    const res = await uploadsRoute.POST(
      multipartRequest(conv.id, [
        png(),
        { name: 'notes.md', type: 'text/markdown', data: new Uint8Array([4]) },
      ]),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      attachments: Array<{ path: string; name: string; mime: string; size: number }>;
    };
    expect(body.attachments).toHaveLength(2);
    expect(body.attachments[0]).toMatchObject({ name: 'shot.png', mime: 'image/png', size: 3 });
    expect(body.attachments[1]).toMatchObject({ name: 'notes.md', mime: 'text/markdown', size: 1 });
    for (const att of body.attachments) {
      expect(att.path.startsWith(`${conv.id}/`)).toBe(true);
      expect(existsSync(join(root, 'data', 'chat', 'uploads', att.path))).toBe(true);
    }
  });

  it('rejects an invalid session id shape with 400', async () => {
    await loadRoot();
    const res = await uploadsRoute.POST(multipartRequest('not-a-uuid', [png()]));
    expect(res.status).toBe(400);
  });

  it('rejects an unknown conversation with 404', async () => {
    await loadRoot();
    const res = await uploadsRoute.POST(
      multipartRequest('11111111-2222-4333-8444-555555555555', [png()]),
    );
    expect(res.status).toBe(404);
  });

  it('rejects a disallowed extension with 400 and writes nothing', async () => {
    await loadRoot();
    const conv = store.createConversation(root);
    const res = await uploadsRoute.POST(
      multipartRequest(conv.id, [
        { name: 'run.exe', type: 'application/x-msdownload', data: new Uint8Array([1]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not allowed/i);
  });

  it('rejects a file over 10MB with 400', async () => {
    await loadRoot();
    const conv = store.createConversation(root);
    const res = await uploadsRoute.POST(
      multipartRequest(conv.id, [
        { name: 'big.png', type: 'image/png', data: new Uint8Array(10 * 1024 * 1024 + 1) },
      ]),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/i);
  });

  it('rejects zero files with 400', async () => {
    await loadRoot();
    const conv = store.createConversation(root);
    const res = await uploadsRoute.POST(multipartRequest(conv.id, []));
    expect(res.status).toBe(400);
  });

  it('rejects a non-multipart body with 400', async () => {
    await loadRoot();
    const res = await uploadsRoute.POST(
      new Request('http://localhost/api/chat/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/chat/uploads/[conversationId]/[file]', () => {
  it('serves stored bytes with the extension-derived content type', async () => {
    await loadRoot();
    const conv = store.createConversation(root);
    const post = await uploadsRoute.POST(multipartRequest(conv.id, [png()]));
    const { attachments } = (await post.json()) as { attachments: Array<{ path: string }> };
    const [conversationId, file] = attachments[0].path.split('/');
    const res = await serveRoute.GET(new Request('http://localhost'), {
      params: Promise.resolve({ conversationId, file }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('refuses traversal shapes and unknown files with 404', async () => {
    await loadRoot();
    const conv = store.createConversation(root);
    await uploadsRoute.POST(multipartRequest(conv.id, [png()]));
    const stored = readdirSync(join(root, 'data', 'chat', 'uploads', conv.id))[0];
    const attempts: Array<{ conversationId: string; file: string }> = [
      { conversationId: '..', file: 'chat.db' },
      { conversationId: conv.id, file: '../../../etc/passwd' },
      { conversationId: conv.id, file: `../${conv.id}/${stored}` },
      { conversationId: conv.id, file: 'nope.png' },
    ];
    for (const params of attempts) {
      const res = await serveRoute.GET(new Request('http://localhost'), {
        params: Promise.resolve(params),
      });
      expect(res.status).toBe(404);
    }
  });
});
