'use client';

// Topbar range trigger + preset popover (7d/30d/90d/180d/365d/all +
// custom) + custom-range modal. Shares the .actions-menu and
// .range-modal chrome with the table/pipeline action menus.

import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/primitives';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import {
  type DateRange,
  type PresetKey,
  presetLabel,
  presetToRange,
} from '@/lib/analytics/compute';

export type Range = DateRange;

interface DateRangePickerProps {
  value: Range;
  onChange: (range: Range) => void;
}

const PRESETS: ReadonlyArray<PresetKey> = ['7d', '30d', '90d', '180d', '365d', 'all'];

function rangeLabel(range: Range): string {
  if (range.preset === 'custom') return `${range.start} → ${range.end}`;
  return presetLabel(range.preset);
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fromInputRef = useRef<HTMLInputElement>(null);
  const fromId = useId();
  const toId = useId();
  const [fromVal, setFromVal] = useState('');
  const [toVal, setToVal] = useState('');

  const closePopover = useCallback(() => setPopoverOpen(false), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  // The dialog claims aria-modal — back it up with the shared focus trap
  // (mirrors screen-modal). The trap restores focus to whatever was focused
  // at activation time; handlePresetClick re-focuses the range trigger before
  // opening the modal so the restore target is the trigger, not the (by then
  // hidden) preset menuitem.
  useFocusTrap(dialogRef, modalOpen);

  // Move focus into the dialog on open (From input), per the modal pattern.
  useEffect(() => {
    if (!modalOpen) return;
    const t = setTimeout(() => fromInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [modalOpen]);

  const openPopover = useCallback(() => {
    setPopoverOpen(true);
  }, []);

  const openModal = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const thirty = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    setFromVal(value.start || thirty);
    setToVal(value.end || today);
    setModalOpen(true);
  }, [value]);

  // Outside-click closes popover (mirrors analytics.html lines 371-375).
  useEffect(() => {
    if (!popoverOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setPopoverOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [popoverOpen]);

  // Escape closes whichever overlay is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (modalOpen) setModalOpen(false);
      else if (popoverOpen) setPopoverOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [popoverOpen, modalOpen]);

  // Position the popover fixed under the trigger.
  useEffect(() => {
    if (!popoverOpen) return;
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const r = trigger.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.top = `${Math.round(r.bottom + 6)}px`;
    popover.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    popover.style.left = 'auto';
  }, [popoverOpen]);

  function handlePresetClick(preset: PresetKey) {
    // Re-focus the trigger before the popover hides — the focused menuitem is
    // about to get `hidden`, which would drop keyboard focus to <body>. Also
    // makes the trigger the focus-trap's restore target for the custom modal.
    triggerRef.current?.focus();
    setPopoverOpen(false);
    if (preset === 'custom') {
      openModal();
      return;
    }
    onChange(presetToRange(preset));
  }

  function handleApply() {
    if (!fromVal || !toVal || fromVal > toVal) return;
    onChange({ start: fromVal, end: toVal, preset: 'custom' });
    setModalOpen(false);
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="range-trigger"
        id="rangeTrigger"
        aria-haspopup="menu"
        aria-expanded={popoverOpen}
        onClick={() => (popoverOpen ? closePopover() : openPopover())}
      >
        <span className="range-trigger__label" id="rangeTriggerLabel">
          {rangeLabel(value)}
        </span>
        <ChevronDown className="range-trigger__chev" aria-hidden="true" strokeWidth={2} />
      </button>

      <aside
        ref={popoverRef}
        className="actions-menu"
        id="rangePopover"
        role="menu"
        aria-label="Date range"
        hidden={!popoverOpen}
        onKeyDown={e => {
          // Arrow-key roving focus within the menu (fix #10).
          const menu = popoverRef.current;
          if (!menu) return;
          const items = Array.from(
            menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([hidden])'),
          );
          if (items.length === 0) return;
          const idx = items.indexOf(document.activeElement as HTMLElement);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[(idx + 1) % items.length]?.focus();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[(idx - 1 + items.length) % items.length]?.focus();
          } else if (e.key === 'Home') {
            e.preventDefault();
            items[0]?.focus();
          } else if (e.key === 'End') {
            e.preventDefault();
            items[items.length - 1]?.focus();
          }
        }}
      >
        <ul className="actions-menu__list">
          {PRESETS.map(preset => (
            <li key={preset}>
              <button
                type="button"
                role="menuitem"
                className={`actions-menu__item${value.preset === preset ? ' is-current' : ''}`}
                data-preset={preset}
                onClick={() => handlePresetClick(preset)}
              >
                <span className="actions-menu__label">
                  <span className="actions-menu__title">{presetLabel(preset)}</span>
                </span>
              </button>
            </li>
          ))}
          <li role="separator" className="actions-menu__sep" />
          <li>
            <button
              type="button"
              role="menuitem"
              className={`actions-menu__item${value.preset === 'custom' ? ' is-current' : ''}`}
              data-preset="custom"
              onClick={() => handlePresetClick('custom')}
            >
              <span className="actions-menu__label">
                <span className="actions-menu__title">Custom range…</span>
              </span>
            </button>
          </li>
        </ul>
      </aside>

      <div className="range-modal" id="rangeModal" hidden={!modalOpen}>
        <div
          className="range-modal__backdrop"
          onClick={closeModal}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') closeModal();
          }}
          role="button"
          tabIndex={-1}
          aria-label="Close"
        />
        <div
          ref={dialogRef}
          className="range-modal__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rangeModalTitle"
        >
          <header className="range-modal__head">
            <h2 id="rangeModalTitle">Custom date range</h2>
            <button
              type="button"
              className="range-modal__close"
              aria-label="Close"
              onClick={closeModal}
            >
              ×
            </button>
          </header>
          <div className="range-modal__body">
            <label className="range-modal__field" htmlFor={fromId}>
              From{' '}
              <input
                ref={fromInputRef}
                type="date"
                id={fromId}
                name="rangeFrom"
                autoComplete="off"
                value={fromVal}
                onChange={e => setFromVal(e.target.value)}
              />
            </label>
            <label className="range-modal__field" htmlFor={toId}>
              To{' '}
              <input
                type="date"
                id={toId}
                name="rangeTo"
                autoComplete="off"
                max={todayStr}
                value={toVal}
                onChange={e => setToVal(e.target.value)}
              />
            </label>
          </div>
          <footer className="range-modal__foot">
            <Button variant="secondary" className="range-modal__cancel" onClick={closeModal}>
              Cancel
            </Button>
            <Button variant="primary" className="range-modal__apply" onClick={handleApply}>
              Apply Date Range
            </Button>
          </footer>
        </div>
      </div>
    </>
  );
}
