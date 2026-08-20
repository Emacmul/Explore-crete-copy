import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Layers, Save, Loader2, FileText, CheckCircle2, Download, Volume2, Lock, Unlock } from 'lucide-react';
import NarrationTtsEditor from './NarrationTtsEditor';
import SimpleAudioUpload from './SimpleAudioUpload';
import { downloadScriptAsDocx } from '@/lib/docxExporter';

/**
 * Segment Script Editor — loaded inside the TourSimulator.
 *
 * Workflow:
 *   1. Combine waypoint scripts in Segment Script Manager (Waypoints tab)
 *   2. Edit break tags here → generate DRAFT audio (Google TTS) for simulator testing
 *   3. Save Final Script & Draft Audio → status = finalized
 *   4. Test in the simulator above
 *   5. Accept Segment → status = accepted
 *   6. Download final .docx script → submit for PCV (Professional Cloned Voice) production
 *   7. Upload the returned PCV MP3 as the Finished Audio (only possible after acceptance)
 *
 * The draft audio generated here is NOT the final audio. The final audio is the
 * PCV production audio made from the accepted script and uploaded only after
 * the segment has been tested and accepted.
 */
export default function SegmentScriptEditor({ segmentScripts, onSegmentScriptsChange, tourCode }) {
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [editScript, setEditScript] = useState('');
  const [editAudioUrl, setEditAudioUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const availableSegments = (segmentScripts || []).filter((s) => s.combined_script);

  // Auto-select first segment
  useEffect(() => {
    if (!selectedSegment && availableSegments.length > 0) {
      setSelectedSegment(availableSegments[0].segment_number);
    }
  }, [availableSegments, selectedSegment]);

  // Load script when segment changes
  useEffect(() => {
    if (!selectedSegment) {
      setEditScript('');
      setEditAudioUrl('');
      return;
    }
    const seg = (segmentScripts || []).find((s) => s.segment_number === selectedSegment);
    if (seg) {
      setEditScript(seg.final_script || seg.combined_script || '');
      setEditAudioUrl(seg.final_audio_url || seg.combined_audio_url || '');
    }
  }, [selectedSegment, segmentScripts]);

  const updateSegment = (segmentNumber, updates) => {
    const updated = (segmentScripts || []).map((s) =>
      s.segment_number === segmentNumber ? { ...s, ...updates } : s
    );
    onSegmentScriptsChange(updated);
  };

  const handleSaveFinal = () => {
    setSaving(true);
    updateSegment(selectedSegment, {
      final_script: editScript,
      final_audio_url: editAudioUrl,
      status: 'finalized',
    });
    setTimeout(() => setSaving(false), 500);
  };

  const handleAccept = () => {
    updateSegment(selectedSegment, { status: 'accepted' });
  };

  const handleRevokeAcceptance = () => {
    updateSegment(selectedSegment, { status: 'finalized', finished_audio_url: '' });
  };

  const handleFinishedAudioChange = (url) => {
    updateSegment(selectedSegment, { finished_audio_url: url });
  };

  const handleDownloadScript = () => {
    if (!editScript) return;
    const seg = (segmentScripts || []).find((s) => s.segment_number === selectedSegment);
    const filename = `${tourCode || 'segment'}_${seg?.segment_id || selectedSegment}_final.docx`;
    downloadScriptAsDocx(editScript, filename);
  };

  if (availableSegments.length === 0) {
    return (
      <div className="bg-slate-800/60 rounded-lg border border-blue-700/40 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          <Label className="text-slate-300 text-sm font-medium">Segment Script Editor</Label>
        </div>
        <div className="flex flex-col items-center justify-center py-6 text-slate-500">
          <Layers className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">No combined segment scripts yet.</p>
          <p className="text-xs mt-1 text-center">
            Use the <strong className="text-slate-400">Segment Script Manager</strong> in the
            Waypoints tab to combine waypoint scripts into segment scripts first.
          </p>
        </div>
      </div>
    );
  }

  const currentSeg = (segmentScripts || []).find((s) => s.segment_number === selectedSegment);
  const isAccepted = currentSeg?.status === 'accepted';
  const isFinalized = currentSeg?.status === 'finalized';

  return (
    <div className="bg-slate-800/60 rounded-lg border border-blue-700/40 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-blue-400" />
        <Label className="text-slate-300 text-sm font-medium">Segment Script Editor</Label>
        <span className="text-xs text-slate-500 ml-1">
          edit break tags → generate draft audio → test in simulator → accept → upload finished audio
        </span>
      </div>

      <Select
        value={selectedSegment || undefined}
        onValueChange={setSelectedSegment}
      >
        <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-9">
          <SelectValue placeholder="Select a segment…" />
        </SelectTrigger>
        <SelectContent>
          {availableSegments.map((seg) => (
            <SelectItem key={seg.segment_number} value={seg.segment_number}>
              {seg.segment_id || `Segment ${seg.segment_number}`}
              {seg.status === 'accepted' ? ' ✓ Accepted' : seg.status === 'finalized' ? ' ✓ Finalized' : ' (draft)'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {currentSeg && (
        <>
          {/* Status indicator */}
          <div className="flex items-center gap-2 text-xs">
            {isAccepted ? (
              <span className="flex items-center gap-1 text-green-400">
                <CheckCircle2 className="w-3 h-3" /> Accepted — finished audio upload unlocked below
              </span>
            ) : isFinalized ? (
              <span className="flex items-center gap-1 text-amber-400">
                <FileText className="w-3 h-3" /> Finalized — test in the simulator above, then accept to unlock finished audio upload
              </span>
              ) : (
              <span className="flex items-center gap-1 text-blue-400">
                <FileText className="w-3 h-3" /> Draft — adjust break tags, generate draft audio, then save
              </span>
            )}
          </div>

          {/* NarrationTtsEditor — generates DRAFT audio (Google TTS) for simulator testing */}
          <NarrationTtsEditor
            key={selectedSegment}
            script={editScript}
            audioUrl={editAudioUrl}
            onScriptChange={setEditScript}
            onAudioChange={setEditAudioUrl}
          />

          {/* Save + Accept controls — hidden once accepted */}
          {!isAccepted && (
            <>
              <Button
                onClick={handleSaveFinal}
                disabled={saving || !editScript?.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 gap-2 text-white"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Final Script & Draft Audio
              </Button>
              <p className="text-xs text-slate-500 text-center">
                Draft audio is generated by Google TTS for simulator testing only — it is not the final audio.
              </p>

              {/* Accept button — only when finalized */}
              {isFinalized && (
                <Button
                  onClick={handleAccept}
                  className="w-full bg-green-600 hover:bg-green-700 gap-2 text-white"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Accept Segment (Tested & Approved)
                </Button>
              )}
            </>
          )}

          {/* Accepted: Download script for PCV production + Upload finished audio */}
          {isAccepted && (
            <div className="space-y-3">
              <div className="bg-green-900/20 border border-green-700/40 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-green-400" />
                  <span className="text-green-300 text-sm font-medium">Step 1: Download Final Script</span>
                </div>
                <p className="text-xs text-slate-400">
                  Download the final script with break tags and submit it for PCV (Professional Cloned Voice) production.
                </p>
                <Button
                  onClick={handleDownloadScript}
                  variant="outline"
                  className="border-green-600 text-green-300 hover:bg-green-900/30 gap-2 w-full"
                >
                  <Download className="w-4 h-4" /> Download .docx Script
                </Button>
              </div>

              <div className="bg-slate-800/50 rounded-lg border border-amber-600/40 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-300 text-sm font-medium">Step 2: Upload Finished Audio (PCV MP3)</span>
                </div>
                <p className="text-xs text-slate-400">
                  Upload the returned PCV MP3. This is the audio users will hear during the tour.
                </p>
                <SimpleAudioUpload
                  audioUrl={currentSeg?.finished_audio_url || ''}
                  onChange={(_field, value) => handleFinishedAudioChange(value)}
                />
              </div>

              <Button
                onClick={handleRevokeAcceptance}
                variant="ghost"
                size="sm"
                className="text-slate-500 hover:text-red-400 gap-1 text-xs w-full"
              >
                <Unlock className="w-3 h-3" /> Revoke acceptance (re-edit segment)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}