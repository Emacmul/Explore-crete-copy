import React, { useRef, useEffect, forwardRef } from 'react';
import { Textarea } from '@/components/ui/textarea';

// A textarea that always grows to fit its full text, so no scrollbar ever
// appears inside it (Enda's request) — the bottom-right drag handle is still
// there when someone wants the box bigger than the text needs.
// The height is re-measured on EVERY render, not only when `value` changes:
// the box also needs re-measuring when the panel it sits in expands, when
// fonts finish loading, or when the window is resized — any of which used to
// leave it one measured-height behind and bring the scrollbar back.
const AutoGrowTextarea = forwardRef(({ value, className = '', rows, ...props }, externalRef) => {
  const innerRef = useRef(null);
  const setRef = (el) => {
    innerRef.current = el;
    if (typeof externalRef === 'function') externalRef(el);
    else if (externalRef) externalRef.current = el;
  };
  const resize = () => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(resize); // after every render, including the first
  useEffect(() => {
    if (typeof document !== 'undefined' && document.fonts?.ready) document.fonts.ready.then(resize);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return (
    <Textarea
      ref={setRef}
      value={value}
      rows={rows || 1}
      className={`overflow-hidden resize-y ${className}`}
      {...props}
    />
  );
});
AutoGrowTextarea.displayName = 'AutoGrowTextarea';

export default AutoGrowTextarea;