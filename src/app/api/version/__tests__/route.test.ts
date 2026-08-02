import { describe, expect, it } from 'vitest';
import packageJson from '../../../../../package.json';
import { GET } from '../route';

describe('GET /api/version', () => {
  it('reports the version baked into the running build', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: packageJson.version });
  });
});
