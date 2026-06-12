// Vitest stub for the 'server-only' package.
// In production (Next.js build), 'server-only' throws when imported from a
// Client Component. In the vitest jsdom environment there is no React server
// bundler, so we replace it with a no-op to let server-lib unit tests run.
export {};
