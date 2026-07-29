import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Play, Clock, Type, Loader2, Volume2 } from 'lucide-react';

export default function TtsSegmentCard({
  segment,
  audioUrl,
  isGenerating,
  isPlaying,
  onPlay,
  onDurationChange,
}) {
  if (segment.type === 'text') {
    return (
      <div className={`bg-slate-800 rounded-lg border p-3 transition-colors ${
        isPlaying ? 'border-purple-500 bg-purple-900/20' : 'border-slate-600'
      }`}>
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
            <Type className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{segment.content}</p>
            <p className="text-xs text-slate-500 mt-1">{segment.content.length} characters</p>
          </div>
          <button
            onClick={() => onPlay(segment.id)}
            disabled={!audioUrl || isGenerating}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-700 disabled:opacity-30 transition-colors"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            ) : isPlaying ? (
              <Volume2 className="w-4 h-4 text-purple-400" />
            ) : (
              <Play className="w-4 h-4 text-slate-400" />
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-slate-800 rounded-lg border p-3 transition-colors ${
      isPlaying ? 'border-amber-500 bg-amber-900/10' : 'border-slate-600'
    }`}>
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-400">Pause</span>
            <span className="text-xs font-medium text-amber-400">{segment.duration.toFixed(1)}s</span>
          </div>
          <Slider
            value={[segment.duration]}
            min={0.5}
            max={120}
            step={0.5}
            onValueChange={(val) => onDurationChange(segment.id, val[0])}
          />
          <div className="flex justify-between mt-0.5">
            <span className="text-[10px] text-slate-600">0.5s</span>
            <span className="text-[10px] text-slate-600">120s</span>
          </div>
        </div>
      </div>
    </div>
  );
}