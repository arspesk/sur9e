'use client';

import { createContext } from 'react';
import type { ReportR } from './report-types';

export const ReportContext = createContext<ReportR | null>(null);
