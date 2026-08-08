import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import {
  Footprints, MapPin, Car, ChevronRight, ShieldCheck, Mic,
  LayoutDashboard, List, Users, Plus, AlertCircle, Volume2,
  Languages, CheckCircle2, Send,
} from 'lucide-react';
import { TOUR_CATEGORIES } from '@/lib/tourCategories';
import CloneTourDialog from './CloneTourDialog';

const CATEGORY_ICONS = { Footprints, MapPin, Car };

function hasMissingAudio(walk) {
  if (walk.route_type !== 'driving_audio_tour') return false;
  return (walk.waypoints || []).some(wp => wp.trigger_audio && !wp.audio_clip_url);
}

function getMissingAudioWaypoints(walk) {
  return (walk.waypoints || [])
    .map((wp, index) => ({ wp, index }))
    .filter(({ wp }) => wp.trigger_audio && !wp.audio_clip_url);
}

function MissingAudioTourCard({ walk, onJumpToWaypoint }) {
  const missingWps = getMissingAudioWaypoints(walk);
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-700">
        <span className="font-mono text-xs bg-slate-700 text-amber-300 px-2 py-1 rounded font-bold shrink-0">{walk.code}</span>
        <span className="font-mono text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded font-bold shrink-0">{walk.tour_category || 'WHT'}</span>
        <p className="font-medium text-white truncate flex-1">{walk.name}</p>
        <span className="text-xs text-amber-400 flex items-center gap-1 shrink-0"><Volume2 className="w-3 h-3" /> {missingWps.length} audio missing</span>
      </div>
      <div className="p-3 space-y-1">
        <p className="text-xs text-slate-500 mb-2">Audio for the following points is missing — click a point to upload its MP3:</p>
        {missingWps.map(({ wp, index }) => {
          const displayName = wp.segment_id || wp.name || `Point ${index + 1}`;
          const subtitle = wp.segment_title && wp.segment_title !== wp.name ? wp.segment_title : (wp.name && wp.name !== displayName ? wp.name : null);
          return (
            <button key={index} onClick={() => onJumpToWaypoint(walk, index)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/40 hover:bg-slate-700/80 transition-colors text-left group">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-slate-300 group-hover:text-white truncate block">{displayName}</span>
                {subtitle && <span className="text-xs text-slate-500 truncate block">{subtitle}</span>}
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-amber-400 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CloneableTourRow({ walk, onClone }) {
  return (
    <button onClick={() => onClone(walk)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-slate-700/60 transition-colors text-left group">
      <span className="font-mono text-xs bg-slate-700 text-amber-300 px-2 py-1 rounded font-bold shrink-0">{walk.code}</span>
      <span className="font-mono text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded font-bold shrink-0">{walk.tour_category || 'WHT'}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white truncate">{walk.name}</p>
        <p className="text-xs text-slate-500">{walk.region || ''}{walk.target_language ? ` · ${walk.target_language}` : ''}</p>
      </div>
      <span className="flex items-center gap-1 text-xs text-purple-300 bg-purple-900/40 border border-purple-700/50 px-2.5 py-1 rounded shrink-0 group-hover:bg-purple-800/60 transition-colors">
        <Languages className="w-3.5 h-3.5" /> Clone
      </span>
    </button>
  );
}

function MyCloneRow({ walk, onContinue }) {
  return (
    <button onClick={() => onContinue(walk)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-slate-700/60 transition-colors text-left group">
      <span className="font-mono text-xs bg-slate-700 text-purple-300 px-2 py-1 rounded font-bold shrink-0">{walk.code}</span>
      <Badge className="text-xs bg-purple-900 text-purple-300 border-purple-700 shrink-0">{walk.target_language}</Badge>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white truncate">{walk.name}</p>
      </div>
      {walk.finished ? (
        <span className="flex items-center gap-1 text-xs text-emerald-300 bg-emerald-900/40 border border-emerald-700/50 px-2 py-1 rounded shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" /> Sent for review
        </span>
      ) : (
        <span className="text-xs text-amber-300 shrink-0">In progress</span>
      )}
      <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-purple-400 transition-colors shrink-0" />
    </button>
  );
}

function ReviewCloneRow({ walk, onReview, onPublish }) {
  return (
    <div className="bg-slate-800 border border-amber-700/40 rounded-xl px-4 py-3 flex items-center gap-3">
      <span className="font-mono text-xs bg-slate-700 text-amber-300 px-2 py-1 rounded font-bold shrink-0">{walk.code}</span>
      <Badge className="text-xs bg-purple-900 text-purple-300 border-purple-700 shrink-0">{walk.target_language}</Badge>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white truncate">{walk.name}</p>
        <p className="text-xs text-slate-500">By {walk.assigned_narrator_email}</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => onReview(walk)} className="border-slate-600 text-slate-200 hover:bg-slate-700 gap-2">
        <ChevronRight className="w-4 h-4" /> Review
      </Button>
      <Button size="sm" onClick={() => onPublish(walk.id)} className="bg-emerald-600 hover:bg-emerald-700 gap-2">
        <Send className="w-4 h-4" /> Publish
      </Button>
    </div>
  );
}

export default function AdminStartScreen({
  userRole, user, works, onNewTour, onContinueTour, onManageUsers, onDashboard, onManageWalks,
  onCloneTour, onPublishClone, cloneableTours = [], myClones = [], reviewClones = [],
}) {
  const isNarrator = userRole === 'narrator';
  const [cloneTarget, setCloneTarget] = useState(null);

  // ----- Narrator view: clone a tour + my clones -----
  if (isNarrator) {
    const sortedCloneable = [...cloneableTours].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return (
      <div className="space-y-8 max-w-3xl mx-auto">
        <CloneTourDialog
          open={!!cloneTarget}
          tour={cloneTarget}
          onClose={() => setCloneTarget(null)}
          onConfirm={async (lang) => {
            const saved = await onCloneTour(cloneTarget, lang);
            setCloneTarget(null);
            if (saved) onContinueTour(saved);
          }}
        />

        <div>
          <h2 className="text-lg font-bold text-white mb-1">Clone a tour to translate</h2>
          <p className="text-sm text-slate-400 mb-3">Pick an existing tour, then choose the language you're translating into. The clone is private to you until you mark it finished.</p>
          {sortedCloneable.length === 0 ? (
            <div className="text-center py-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">
              <Languages className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No tours available to clone yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedCloneable.map(walk => <CloneableTourRow key={walk.id} walk={walk} onClone={setCloneTarget} />)}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-bold text-white mb-3">My translation clones</h2>
          {myClones.length === 0 ? (
            <div className="text-center py-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">
              <Mic className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No clones yet</p>
              <p className="text-sm">Clone a tour above to start a translation.</p>
            </div>
          ) : (
            <div className="space-y-2">{myClones.map(walk => <MyCloneRow key={walk.id} walk={walk} onContinue={onContinueTour} />)}</div>
          )}
        </div>
      </div>
    );
  }

  // ----- Admin view -----
  const unfinishedWalks = works.filter(hasMissingAudio).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* New Tour */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3">New Tour</h2>
        <div className="space-y-2">
          {TOUR_CATEGORIES.map((cat, index) => {
            const Icon = CATEGORY_ICONS[cat.icon] || MapPin;
            const colourMap = {
              emerald: 'from-emerald-600 to-green-700 hover:from-emerald-700 hover:to-green-800',
              amber: 'from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-800',
              blue: 'from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800',
            };
            return (
              <motion.button
                key={cat.code}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => onNewTour(cat.code)}
                className={`w-full bg-gradient-to-r ${colourMap[cat.color]} text-white rounded-xl p-4 shadow-lg flex items-center gap-3 transition-all hover:shadow-xl hover:scale-[1.01] active:scale-[0.99] text-left`}
              >
                <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-white/25 px-1.5 py-0.5 rounded font-bold">{cat.code}</span>
                    <span className="font-bold">{cat.label}</span>
                  </div>
                  <p className="text-sm text-white/80 mt-0.5">{cat.description}</p>
                </div>
                <Plus className="w-5 h-5 opacity-70 shrink-0" />
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Translations awaiting review */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2"><Languages className="w-5 h-5 text-purple-400" /> Translations awaiting review</h2>
        {reviewClones.length === 0 ? (
          <div className="text-center py-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No finished translations waiting</p>
          </div>
        ) : (
          <div className="space-y-2">{reviewClones.map(walk => <ReviewCloneRow key={walk.id} walk={walk} onReview={onContinueTour} onPublish={onPublishClone} />)}</div>
        )}
      </div>

      {/* Continue Working */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3">Continue Working</h2>
        {unfinishedWalks.length === 0 ? (
          <div className="text-center py-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">
            <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">All audio clips uploaded</p>
          </div>
        ) : (
          <div className="space-y-3">{unfinishedWalks.map(walk => <MissingAudioTourCard key={walk.id} walk={walk} onJumpToWaypoint={onContinueTour} />)}</div>
        )}
      </div>

      {/* Admin tools */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3">Admin Tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button variant="outline" onClick={onDashboard} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2 h-auto py-3 justify-start">
            <LayoutDashboard className="w-5 h-5 text-amber-400" />
            <div className="text-left"><p className="font-medium">Dashboard</p><p className="text-xs text-slate-400">Overview & stats</p></div>
          </Button>
          <Button variant="outline" onClick={onManageWalks} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2 h-auto py-3 justify-start">
            <List className="w-5 h-5 text-blue-400" />
            <div className="text-left"><p className="font-medium">Manage Tours</p><p className="text-xs text-slate-400">All tours</p></div>
          </Button>
          <Button variant="outline" onClick={onManageUsers} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2 h-auto py-3 justify-start">
            <Users className="w-5 h-5 text-purple-400" />
            <div className="text-left"><p className="font-medium">Manage Users</p><p className="text-xs text-slate-400">Promote / set Narr passwords</p></div>
          </Button>
        </div>
      </div>
    </div>
  );
}