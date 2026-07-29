import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Ticket, Download, ArrowLeft, CheckCircle2, Clock, Upload, AlertCircle, FileText, Trash2 } from 'lucide-react';

// Proper RFC 4180 CSV parser — handles commas inside quoted fields, international characters
function parseCSVLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } // escaped quote
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

function parseCSV(text) {
  // Strip UTF-8 BOM if present
  const cleaned = text.replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { error: 'CSV must have a header row and at least one data row.' };

  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const codeIdx = header.findIndex(h => h === 'code');

  if (codeIdx === -1) return { error: 'CSV must have a "code" column.' };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const code = cols[codeIdx]?.toUpperCase();
    if (code) rows.push({ code });
  }

  if (rows.length === 0) return { error: 'No valid rows found in CSV.' };
  return { rows };
}

export default function VoucherManager({ walk, onBack }) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const fileInputRef = useRef();
  const queryClient = useQueryClient();

  const { data: vouchers = [], isLoading } = useQuery({
    queryKey: ['vouchers', walk.id],
    queryFn: () => base44.entities.VoucherCode.filter({ walk_id: walk.id }, '-created_date', 1000),
  });

  const unusedCount = vouchers.filter(v => !v.used).length;
  const usedCount = vouchers.filter(v => v.used).length;

  const handleCSVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);

    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file, 'UTF-8');
    });
    const parsed = parseCSV(text);

    if (parsed.error) {
      setImportResult({ error: parsed.error });
      setImporting(false);
      e.target.value = '';
      return;
    }

    // Deduplicate against existing codes
    const existingCodes = new Set(vouchers.map(v => v.code));
    const newRows = parsed.rows.filter(r => !existingCodes.has(r.code));
    const skipped = parsed.rows.length - newRows.length;

    if (newRows.length === 0) {
      setImportResult({ error: `All ${parsed.rows.length} codes already exist in the database.` });
      setImporting(false);
      e.target.value = '';
      return;
    }

    const batch = newRows.map(r => ({
      code: r.code,
      walk_id: walk.id,
      walk_name: walk.name,
      used: false,
    }));

    await base44.entities.VoucherCode.bulkCreate(batch);
    queryClient.invalidateQueries({ queryKey: ['vouchers', walk.id] });
    setImportResult({ added: newRows.length, skipped });
    setImporting(false);
    e.target.value = '';
  };

  const handleArchiveUsed = async () => {
    if (!archiveConfirm) { setArchiveConfirm(true); return; }
    setArchiving(true);
    setArchiveConfirm(false);
    const usedVouchers = vouchers.filter(v => v.used);
    await Promise.all(usedVouchers.map(v => base44.entities.VoucherCode.delete(v.id)));
    queryClient.invalidateQueries({ queryKey: ['vouchers', walk.id] });
    setArchiving(false);
  };

  const handleExportCSV = () => {
    const unused = vouchers.filter(v => !v.used);
    const rows = [['Code', 'Walk', 'GPX URL', 'Status'], ...unused.map(v => [v.code, v.walk_name, v.gpx_url || '', 'Unused'])];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vouchers-${walk.code}-unused.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div onClick={(e) => { if (archiveConfirm && !e.target.closest('[data-archive]')) setArchiveConfirm(false); }}>
      <div className="flex items-center gap-3 mb-6 mt-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-slate-300 hover:text-white gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-500/20 rounded-lg">
            <Ticket className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Voucher Codes — {walk.name}</h2>
            <p className="text-xs text-slate-400">{walk.code}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-800 rounded-xl p-4 text-center border border-slate-700">
          <p className="text-3xl font-bold text-white">{vouchers.length}</p>
          <p className="text-xs text-slate-400 mt-1">Total Imported</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 text-center border border-green-900">
          <p className="text-3xl font-bold text-green-400">{unusedCount}</p>
          <p className="text-xs text-slate-400 mt-1">Available</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 text-center border border-slate-700">
          <p className="text-3xl font-bold text-slate-400">{usedCount}</p>
          <p className="text-xs text-slate-400 mt-1">Redeemed</p>
        </div>
      </div>

      {/* CSV Import */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
        <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
          <Upload className="w-4 h-4 text-amber-400" /> Import Codes from CSV
        </h3>
        <p className="text-slate-400 text-xs mb-4">
          Your CSV only needs one column: <span className="font-mono text-amber-300">code</span>. The GPX file is stored securely in the walk itself — no URLs needed.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? 'Importing…' : 'Upload CSV'}
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCSVUpload} disabled={importing} />
          </label>

          {unusedCount > 0 && (
            <Button variant="outline" onClick={handleExportCSV} className="border-slate-600 text-slate-300 hover:text-white gap-2">
              <Download className="w-4 h-4" /> Export Unused as CSV
            </Button>
          )}

          {usedCount > 0 && (
            <Button
              variant="outline"
              data-archive="true"
              onClick={handleArchiveUsed}
              disabled={archiving}
              className={`gap-2 transition-colors ${archiveConfirm ? 'border-red-500 text-red-400 hover:bg-red-900/30' : 'border-slate-600 text-slate-400 hover:text-white'}`}
            >
              {archiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {archiving ? 'Archiving…' : archiveConfirm ? `Confirm — delete ${usedCount} used codes?` : `Archive ${usedCount} Used Codes`}
            </Button>
          )}
        </div>

        {importResult && (
          <div className={`mt-3 flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${importResult.error ? 'bg-red-900/30 border border-red-700/50 text-red-300' : 'bg-green-900/30 border border-green-700/50 text-green-300'}`}>
            {importResult.error
              ? <><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {importResult.error}</>
              : <><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> {importResult.added} code{importResult.added !== 1 ? 's' : ''} imported successfully{importResult.skipped > 0 ? ` (${importResult.skipped} skipped — already existed)` : ''}.</>
            }
          </div>
        )}

        {/* Example CSV */}
        <div className="mt-4 bg-slate-900 rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" /> Example CSV format:</p>
          <pre className="text-xs text-amber-300 font-mono">
{`code
WALK-A1B2-C3D4
WALK-E5F6-G7H8
WALK-J9K0-L1M2`}
          </pre>
        </div>
      </div>

      {/* Code list */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
        </div>
      ) : vouchers.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Ticket className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No codes yet</p>
          <p className="text-sm">Upload a CSV file to import codes</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {vouchers.map(v => (
            <div key={v.id} className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <span className="font-mono text-sm text-amber-300 tracking-wider">{v.code}</span>
              {v.used ? (
                <div className="flex items-center gap-2 text-right">
                  <div className="hidden sm:block text-right">
                    <p className="text-xs text-slate-500">{v.used_by}</p>
                    <p className="text-xs text-slate-600">{v.used_at ? new Date(v.used_at).toLocaleDateString() : ''}</p>
                  </div>
                  <Badge className="bg-slate-700 text-slate-400 shrink-0 gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Used
                  </Badge>
                </div>
              ) : (
                <Badge className="bg-green-900 text-green-300 shrink-0 gap-1">
                  <Clock className="w-3 h-3" /> Available
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}