import React, { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export default function DateOfBirthSelect({ value, onChange }) {
  const [y, m, d] = useMemo(() => {
    if (!value) return ['', '', ''];
    const p = String(value).split('-');
    return p.length === 3 ? [p[0], p[1], p[2]] : ['', '', ''];
  }, [value]);

  const year = y ? Number(y) : '';
  const month = m ? Number(m) : '';
  const day = d ? Number(d) : '';
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let yr = currentYear; yr >= 1920; yr--) years.push(yr);

  const setPart = (part, val) => {
    const ny = part === 'year' ? val : year;
    const nm = part === 'month' ? val : month;
    const nd = part === 'day' ? val : day;
    if (ny && nm && nd) {
      const maxDay = daysInMonth(Number(ny), Number(nm));
      const clamped = Math.min(Number(nd), maxDay);
      onChange(`${ny}-${String(nm).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`);
    } else {
      onChange('');
    }
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      <div>
        <Label className="text-slate-300 mb-1.5 block text-xs">Day</Label>
        <Select value={day ? String(day) : ''} onValueChange={v => setPart('day', Number(v))}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue placeholder="Day" /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 31 }, (_, i) => i + 1).map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-slate-300 mb-1.5 block text-xs">Month</Label>
        <Select value={month ? String(month) : ''} onValueChange={v => setPart('month', Number(v))}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue placeholder="Month" /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, i) => <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-slate-300 mb-1.5 block text-xs">Year</Label>
        <Select value={year ? String(year) : ''} onValueChange={v => setPart('year', Number(v))}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue placeholder="Year" /></SelectTrigger>
          <SelectContent>
            {years.map(yr => <SelectItem key={yr} value={String(yr)}>{yr}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}