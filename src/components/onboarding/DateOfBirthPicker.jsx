import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Day / Month / Year dropdown picker for a date of birth.
 * Replaces the native <input type="date">, whose year wheel is hard to scroll
 * on mobile (so people ended up "born in the current year"). Three plain
 * selects let every field — including the year — be chosen directly.
 * Value is a 'YYYY-MM-DD' string (or '' when incomplete).
 */
export default function DateOfBirthPicker({ value, onChange }) {
  const parts = value ? value.split('-') : [];
  const selectedYear = parts[0] ? Number(parts[0]) : null;
  const selectedMonth = parts[1] ? Number(parts[1]) : null; // 1-12
  const selectedDay = parts[2] ? Number(parts[2]) : null;

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1900 + 1 }, (_, i) => currentYear - i); // newest first
  const daysInMonth = selectedYear && selectedMonth
    ? new Date(selectedYear, selectedMonth, 0).getDate()
    : 31;
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const emit = (y, m, d) => {
    const maxDay = y && m ? new Date(y, m, 0).getDate() : 31;
    const effDay = d ? Math.min(d, maxDay) : null;
    if (y && m && effDay) {
      onChange(`${y}-${String(m).padStart(2, '0')}-${String(effDay).padStart(2, '0')}`);
    } else {
      onChange('');
    }
  };

  const triggerClass = 'bg-white/10 border-white/20 text-white';

  return (
    <div className="grid grid-cols-3 gap-2">
      <div>
        <Label className="text-blue-100 text-xs mb-1 block">Day</Label>
        <Select value={selectedDay ? String(selectedDay) : undefined} onValueChange={(v) => emit(selectedYear, selectedMonth, Number(v))}>
          <SelectTrigger className={triggerClass}><SelectValue placeholder="Day" /></SelectTrigger>
          <SelectContent>
            {days.map(d => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-blue-100 text-xs mb-1 block">Month</Label>
        <Select value={selectedMonth ? String(selectedMonth) : undefined} onValueChange={(v) => emit(selectedYear, Number(v), selectedDay)}>
          <SelectTrigger className={triggerClass}><SelectValue placeholder="Month" /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, i) => <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-blue-100 text-xs mb-1 block">Year</Label>
        <Select value={selectedYear ? String(selectedYear) : undefined} onValueChange={(v) => emit(Number(v), selectedMonth, selectedDay)}>
          <SelectTrigger className={triggerClass}><SelectValue placeholder="Year" /></SelectTrigger>
          <SelectContent>
            {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}