'use client';

import { NodeViewWrapper } from '@tiptap/react';
import { useContext } from 'react';
import { ReportContext } from '../report-context';
import { ReportSnapshot } from '../sections/report-snapshot';

// Rendered by ProseMirror via ReactNodeViewRenderer for each `snapshot`
// node in the document. Reads the report `r` from context (provided by
// ReportRender) and delegates to the existing widget. contentEditable=false
// is mandatory — without it ProseMirror tries to manage the widget's
// interior DOM and breaks selection + crashes the radar SVG.
export function SnapshotNodeView() {
  const r = useContext(ReportContext);
  if (!r) return null;
  return (
    <NodeViewWrapper className="snapshot-block" contentEditable={false}>
      <ReportSnapshot r={r} inline />
    </NodeViewWrapper>
  );
}
