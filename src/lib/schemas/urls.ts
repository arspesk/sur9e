import { z } from 'zod';

export const HttpUrl = z
  .string()
  .url()
  .refine(value => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'URL must use http or https',
  });
