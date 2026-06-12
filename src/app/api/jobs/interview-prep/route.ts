export const runtime = 'nodejs';

import { startJobByNum } from '@/lib/api/jobs';

export const POST = (req: Request) => startJobByNum('interview-prep', req);
