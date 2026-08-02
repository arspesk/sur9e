export const runtime = 'nodejs';

import packageJson from '../../../../package.json';

export function GET() {
  return Response.json({
    version: packageJson.version,
    launchId: process.env.SUR9E_WEB_LAUNCH_ID ?? null,
  });
}
