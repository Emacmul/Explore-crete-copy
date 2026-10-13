import React, { useRef, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';

// A textarea that always grows to fit its full text, so no scrollbar ever
// appears inside it (Enda's request) — the bottom-right drag handle is still
// there when someone wants the box bigger than the text needs.
export default function AutoGrowTextarea({ value, className = '', rows, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      value={value}
      rows={rows || 1}
      className={`overflow-hidden resize-y ${className}`}
      {...props}
    />
  );
}