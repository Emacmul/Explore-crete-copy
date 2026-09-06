import React, { useState, useEffect, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function parseValue(value) {
  if (!value) return { year: '', month: '', day: '' };
  const p = String(value).split('-');
  if (p.length !== 3) return { year: '', month: '', day: '' };
  return { year: Number(p[0]) || '', month: Number(p[1]) || '', day: Number(p[2]) || '' };
}

/**
 * Per Enda's front-end audit (2026-09-05): this control used to derive Day/Month/Year
 * purely from the `value` prop on every render, with nowhere to hold a pick that
 * wasn't a complete date yet. So for a user who had never had a date of birth set
 * (value === ''), picking just the Year, say, called onChange('') right back —
 * the pick vanished immediately, and there was no way to ever assemble a first
 * date at all. Fixed by keeping Day/Month/Year in this component's own state,
 * seeded from `value` and updated as each box is picked; a partial pick now stays
 * on screen, and `onChange` only fires once all three are set and form a real date.
 */
export default function DateOfBirthSelect({ value, onChange }) {
  const [parts, setParts] = useState(() => parseValue(value));
  // Tracks the last value we ourselves reported via onChange, so we can tell an
  // external change (e.g. this dialog reopened for a different user) apart from
  // the parent simply echoing back the value we just gave it.
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setParts(parseValue(value));
    }
  }, [value]);

  const currentYear = new Date().getFullYear();
  const years = [];
  for (let yr = currentYear; yr >= 1920; yr--) years.push(yr);

  const setPart = (part, val) => {
    const next = { ...parts, [part]: val };
    setParts(next);
    if (next.year && next.month && next.day) {
      const maxDay = daysInMonth(Number(next.year), Number(next.month));
      const clamped = Math.min(Number(next.day), maxDay);
      const assembled = `${next.year}-${String(next.month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
      lastEmittedRef.current = assembled;
      onChange(assembled);
    }
    // Else: still incomplete (e.g. only Day and Month picked so far). Leave the
    // boxes already filled in as they are — don't call onChange, since there's
    // no complete date yet to save.
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      <div>
        <Label className="text-slate-300 mb-1.5 block text-xs">Day</Label>
        <Select value={parts.day ? String(parts.day) : ''} onValueChange={v => setPart('day', Number(v))}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue placeholder="Day" /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 31 }, (_, i) => i + 1).map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-slate-300 mb-1.5 block text-xs">Month</Label>
        <Select value={parts.month ? String(parts.month) : ''} onValueChange={v => setPart('month', Number(v))}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue placeholder="Month" /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, i) => <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-slate-300 mb-1.5 block text-xs">Year</Label>
        <Select value={parts.year ? String(parts.year) : ''} onValueChange={v => setPart('year', Number(v))}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue placeholder="Year" /></SelectTrigger>
          <SelectContent>
            {years.map(yr => <SelectItem key={yr} value={String(yr)}>{yr}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
