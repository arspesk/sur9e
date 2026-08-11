import { ArrowDown } from 'lucide-react';

export function ScrollToBottom({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Scroll to bottom"
      className="flex items-center justify-center size-10 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white shadow-lg transition-opacity"
    >
      <ArrowDown className="size-5" />
    </button>
  );
}
