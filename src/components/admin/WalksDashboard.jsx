import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Sparkles, Ticket, Mountain, MapPin, Clock, Route, TrendingUp, CheckCircle2, XCircle, Users } from 'lucide-react';

const DIFFICULTY_COLORS = {
  easy: 'bg-green-900/40 text-green-300 border-green-700',
  moderate: 'bg-amber-900/40 text-amber-300 border-amber-700',
  challenging: 'bg-orange-900/40 text-orange-300 border-orange-700',
  difficult: 'bg-red-900/40 text-red-300 border-red-700',
};

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <Card className="bg-slate-800 border-slate-700 p-4 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-slate-400">{label}</p>
      </div>
    </Card>
  );
}

function getAccessLabel(walk) {
  if (walk.walk_category === 'community') {
    return {
      label: 'Community Contribution',
      icon: Users,
      className: 'text-blue-400 bg-blue-900/40 border-blue-700',
    };
  }

  if (walk.is_sample_walk) {
    return {
      label: 'Sample Walk',
      icon: Sparkles,
      className: 'text-emerald-400 bg-emerald-900/40 border-emerald-700',
    };
  }

  return {
    label: 'Purchase Required',
    icon: Ticket,
    className: 'text-amber-400 bg-amber-900/40 border-amber-700',
  };
}

export default function WalksDashboard({ walks }) {
  const totalWalks = walks.length;
  const sampleWalks = walks.filter(w => w.is_sample_walk);
  const communityWalks = walks.filter(w => w.walk_category === 'community');
  const withGpx = walks.filter(w => w.gpx_file_uri || w.gpx_url);

  const byRegion = walks.reduce((acc, w) => {
    const r = w.region || 'Unknown';
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Mountain} label="Total Walks" value={totalWalks} color="bg-slate-600" />
        <StatCard icon={Sparkles} label="Sample Walks" value={sampleWalks.length} color="bg-emerald-600" />
        <StatCard icon={Users} label="Community" value={communityWalks.length} color="bg-blue-600" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
        <StatCard icon={CheckCircle2} label="GPX Ready" value={withGpx.length} color="bg-blue-600" />
      </div>

      {Object.keys(byRegion).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">By Region</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byRegion).sort((a, b) => b[1] - a[1]).map(([region, count]) => (
              <div key={region} className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-sm text-white font-medium">{region}</span>
                <span className="text-xs text-slate-400">({count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">All Walks</h3>
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 border-b border-slate-700">
              <tr>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Walk</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium hidden sm:table-cell">Difficulty</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium hidden md:table-cell">Stats</th>
                <th className="text-center px-4 py-3 text-slate-400 font-medium">Access</th>
                <th className="text-center px-4 py-3 text-slate-400 font-medium">GPX</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800">
              {walks.map(walk => {
                const access = getAccessLabel(walk);
                const AccessIcon = access.icon;

                return (
                  <tr key={walk.id} className="bg-slate-900/50 hover:bg-slate-800/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-slate-400 mb-0.5">{walk.code}</div>
                      <div className="font-medium text-white truncate max-w-[180px]">{walk.name}</div>
                      {walk.region && <div className="text-xs text-slate-500 mt-0.5">{walk.region}</div>}
                      {walk.walk_category === 'community' && walk.contributor_name && (
                        <div className="text-xs text-blue-400 mt-0.5">By {walk.contributor_name}</div>
                      )}
                    </td>

                    <td className="px-4 py-3 hidden sm:table-cell">
                      {walk.difficulty ? (
                        <Badge variant="outline" className={`text-xs w-fit capitalize ${DIFFICULTY_COLORS[walk.difficulty] || ''}`}>
                          {walk.difficulty}
                        </Badge>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex flex-col gap-1 text-xs text-slate-400">
                        {walk.distance_km && (
                          <span className="flex items-center gap-1"><Route className="w-3 h-3" />{walk.distance_km} km</span>
                        )}
                        {walk.duration_hours && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{walk.duration_hours}h</span>
                        )}
                        {walk.elevation_gain_m && (
                          <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{walk.elevation_gain_m}m</span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium border px-2 py-1 rounded-full ${access.className}`}>
                        <AccessIcon className="w-3 h-3" /> {access.label}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      {(walk.gpx_file_uri || walk.gpx_url) ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400/60 mx-auto" />
                      )}
                    </td>
                  </tr>
                );
              })}

              {walks.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">No walks yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}