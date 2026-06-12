export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <p className="text-sm font-medium" style={{ color: 'var(--text-3)' }}>
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text)' }}>
        Page not found
      </h1>
    </main>
  );
}
