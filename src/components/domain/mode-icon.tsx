// components/domain/mode-icon.tsx
//
// Renders a MODE_REGISTRY icon (an SVG markup string from
// features/report/report-toolbar-config.ts — our own code, never user
// content) as a 16px menu icon. Same trusted-source injection approach as
// the editor slash menu (cmdk-slash-menu.tsx).

interface ModeIconProps {
  svg: string;
}

export function ModeIcon({ svg }: ModeIconProps) {
  return (
    <span className="mode-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
