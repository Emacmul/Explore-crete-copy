import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Layers, Loader2, Save, CheckCircle2, FileText, AlertCircle } from 'lucide-react';

/**
 * Parse a waypoint name following the convention XXX<segment><letter>[-PS]
 * e.g. "WRC1a-PS" → { segment: 1, letterOrder: 1 }
 * Used to sort waypoints within a segment by their letter suffix (a, b, c…).
 */
function parseWpNameSortKey(name) {
  if (!name) return null;
  const m = name.match(/^([A-Z]{3})(\d+)([a-z])(?:-PS)?(?:\s|$)/);
  if (!m) return null;
  return {
    segment: parseInt(m[2], 10),
    letterOrder: m[3].charCodeAt(0) - 96,
  };
}

/**
 * Groups waypoints by segment_number, sorts each group by name letter suffix,
 * and provides "Combine & Save" to concatenate all narration scripts in a segment
 * into a single combined script (with <break> tags between them).
 *
 * The combined scripts are stored on the walk entity's segment_scripts field
 * and can be recalled in the TourSimulator for break-tag timing adjustments.
 */
export default function SegmentScriptManager({ waypoints, segmentScripts, onSegmentScriptsChange, onSave, saving }) {
  const [combiningSegment, setCombiningSegment] = useState(null);

  const segments = useMemo(() => {
    const groups = {};
    waypoints.forEach((wp) => {
      const segNum = wp.segment_number || '?';
      if (!groups[segNum]) {
        groups[segNum] = {
          segmentNumber: segNum,
          segmentId: wp.segment_id || '',
          segmentTitle: wp.segment_title || '',
          waypoints: [],
        };
      }
      groups[segNum].waypoints.push(wp);
    });
    // Sort waypoints within each segment by letter suffix (a, b, c…)
    Object.values(groups).forEach((group) => {
      group.waypoints.sort((a, b) => {
        const ka = parseWpNameSortKey(a.name || a.segment_id);
        const kb = parseWpNameSortKey(b.name || b.segment_id);
        if (ka && kb) return ka.letterOrder - kb.letterOrder;
        if (ka) return -1;
        if (kb) return 1;
        return 0;
      });
    });
    return Object.values(groups).sort((a, b) => {
      const na = parseInt(a.segmentNumber, 10);
      const nb = parseInt(b.segmentNumber, 10);
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      return na - nb;
    });
  }, [waypoints]);

  const getSegmentScript = (segNum) =>
    (segmentScripts || []).find((s) => s.segment_number === segNum);

  const combineSegment = (segment) => {
    const parts = segment.waypoints
      .filter((wp) => wp.narration_script?.trim())
      .map((wp) => wp.narration_script.trim());
    if (parts.length === 0) return null;
    return parts.join('\n<break time="0.5s"/>\n');
  };

  const upsertSegmentScript = (segmentNumber, segmentId, combined) => {
    const existing = (segmentScripts || []).find(
      (s) => s.segment_number === segmentNumber
    );
    if (existing) {
      return (segmentScripts || []).map((s) =>
        s.segment_number === segmentNumber
          ? { ...s, combined_script: combined, segment_id: segmentId }
          : s
      );
    }
    return [
      ...(segmentScripts || []),
      {
        segment_number: segmentNumber,
        segment_id: segmentId,
        combined_script: combined,
        status: 'draft',
      },
    ];
  };

  const handleCombine = (segment) => {
    setCombiningSegment(segment.segmentNumber);
    const combined = combineSegment(segment);
    if (combined) {
      onSegmentScriptsChange(
        upsertSegmentScript(segment.segmentNumber, segment.segmentId, combined)
      );
    }
    setCombiningSegment(null);
  };

  const handleCombineAll = () => {
    let updated = [...(segmentScripts || [])];
    segments.forEach((segment) => {
      const combined = combineSegment(segment);
      if (!combined) return;
      const existingIdx = updated.findIndex(
        (s) => s.segment_number === segment.segmentNumber
      );
      if (existingIdx >= 0) {
        updated[existingIdx] = {
          ...updated[existingIdx],
          combined_script: combined,
          segment_id: segment.segmentId,
        };
      } else {
        updated.push({
          segment_number: segment.segmentNumber,
          segment_id: segment.segmentId,
          combined_script: combined,
          status: 'draft',
        });
      }
    });
    onSegmentScriptsChange(updated);
  };

  return (
    <div className="bg-slate-800/50 rounded-lg border border-emerald-600/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-400" />
          <Label className="text-white text-sm font-bold">Segment Script Manager</Label>
        </div>
        <Button
          size="sm"
          onClick={handleCombineAll}
          className="bg-emerald-600 hover:bg-emerald-700 gap-2 text-white"
        >
          <Layers className="w-3.5 h-3.5" /> Combine All
        </Button>
      </div>
      <p className="text-xs text-slate-400">
        Combines all waypoint narration scripts within each segment (sorted by waypoint
        code: a, b, c…) into a single segment script with break tags. Saved scripts can
        be recalled in the Simulator for break-tag timing adjustments, then downloaded
        as the final script for ElevenLabs.
      </p>

      <div className="space-y-2">
        {segments.map((segment) => {
          const segScript = getSegmentScript(segment.segmentNumber);
          const hasScripts = segment.waypoints.some((wp) => wp.narration_script?.trim());
          const scriptCount = segment.waypoints.filter((wp) => wp.narration_script?.trim()).length;

          return (
            <div key={segment.segmentNumber} className="bg-slate-700/50 rounded-lg border border-slate-600 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-medium text-sm">
                    {segment.segmentId || `Segment ${segment.segmentNumber}`}
                  </span>
                  {segment.segmentTitle && (
                    <span className="text-xs text-slate-400">{segment.segmentTitle}</span>
                  )}
                  <span className="text-xs text-slate-500">
                    {scriptCount}/{segment.waypoints.length} scripts
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {segScript?.status === 'accepted' && (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle2 className="w-3 h-3" /> Accepted
                    </span>
                  )}
                  {segScript?.status === 'finalized' && (
                    <span className="flex items-center gap-1 text-xs text-amber-400">
                      <CheckCircle2 className="w-3 h-3" /> Finalized
                    </span>
                  )}
                  {segScript?.combined_script && !segScript?.status && (
                    <span className="flex items-center gap-1 text-xs text-blue-400">
                      <FileText className="w-3 h-3" /> Draft saved
                    </span>
                  )}
                  {segScript?.status === 'draft' && (
                    <span className="flex items-center gap-1 text-xs text-blue-400">
                      <FileText className="w-3 h-3" /> Draft saved
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCombine(segment)}
                    disabled={!hasScripts || combiningSegment === segment.segmentNumber}
                    className="border-emerald-600 text-emerald-300 hover:bg-emerald-900/30 h-7 text-xs gap-1"
                  >
                    {combiningSegment === segment.segmentNumber ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Layers className="w-3 h-3" />
                    )}
                    Combine & Save
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {segment.waypoints.map((wp, i) => (
                  <span
                    key={i}
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      wp.narration_script?.trim()
                        ? 'bg-emerald-900/40 text-emerald-300'
                        : 'bg-slate-800 text-slate-600'
                    }`}
                  >
                    {wp.name || wp.segment_id || `WP${i + 1}`}
                  </span>
                ))}
              </div>

              {!hasScripts && (
                <div className="flex items-center gap-1 text-xs text-slate-600 mt-1">
                  <AlertCircle className="w-3 h-3" /> No narration scripts in this segment yet
                </div>
              )}
            </div>
          );
        })}
      </div>

      {onSave && (
        <div className="pt-2 border-t border-slate-600">
          <Button
            onClick={onSave}
            disabled={saving}
            className="w-full bg-amber-500 hover:bg-amber-600 gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Route
          </Button>
        </div>
      )}
    </div>
  );
}