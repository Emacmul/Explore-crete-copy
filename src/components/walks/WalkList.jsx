import React, { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Mountain, SlidersHorizontal, X, RefreshCw } from 'lucide-react';
import WalkCard from './WalkCard';
import OfflineWalksBanner from '../offline/OfflineWalksBanner';
import { getTourCategory } from '../../lib/tourCategories';

const REGIONS = ['Chania', 'Rethymno', 'Heraklion', 'Lasithi'];
const DIFFICULTIES = ['easy', 'moderate', 'challenging', 'difficult'];

export default function WalkList({ walks, selectedWalk, onWalkSelect, searchQuery, onSearchChange, onRefresh, refreshing, tourCategoryCode, accessibleMap = {} }) {
  const pluralLabel = getTourCategory(tourCategoryCode).pluralLabel;
  const [showFilters, setShowFilters] = useState(false);
  const [region, setRegion] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  const [maxDistance, setMaxDistance] = useState('all');
  const [maxDuration, setMaxDuration] = useState('all');
  const [sortBy, setSortBy] = useState('name');

  const activeFilterCount = [
    region !== 'all', difficulty !== 'all', maxDistance !== 'all', maxDuration !== 'all'
  ].filter(Boolean).length;

  const clearFilters = () => {
    setRegion('all');
    setDifficulty('all');
    setMaxDistance('all');
    setMaxDuration('all');
    setSortBy('name');
  };

  const filteredWalks = walks
    .filter(walk => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q ||
        walk.name?.toLowerCase().includes(q) ||
        walk.code?.toLowerCase().includes(q) ||
        walk.region?.toLowerCase().includes(q);
      const matchesRegion = region === 'all' || walk.region === region;
      const matchesDifficulty = difficulty === 'all' || walk.difficulty === difficulty;
      const matchesDistance = maxDistance === 'all' || (walk.distance_km || 0) <= Number(maxDistance);
      const matchesDuration = maxDuration === 'all' || (walk.duration_hours || 0) <= Number(maxDuration);
      return matchesSearch && matchesRegion && matchesDifficulty && matchesDistance && matchesDuration;
    })
    .sort((a, b) => {
      if (sortBy === 'distance') return (a.distance_km || 0) - (b.distance_km || 0);
      if (sortBy === 'duration') return (a.duration_hours || 0) - (b.duration_hours || 0);
      if (sortBy === 'difficulty') {
        const order = { easy: 0, moderate: 1, challenging: 2, difficult: 3 };
        return (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1);
      }
      return (a.name || '').localeCompare(b.name || '');
    });

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b bg-gradient-to-r from-slate-800 to-slate-900">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <img src="/explore-crete-logo.png" alt="Explore Crete" className="w-9 h-9 rounded-lg object-contain" />
            <div>
              <h2 className="font-bold text-white">All {pluralLabel}</h2>
              <p className="text-xs text-slate-400">{filteredWalks.length} of {walks.length} {pluralLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={refreshing}
                title="Reload the walk list from the server"
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 border border-blue-400 rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFilters(f => !f)}
              className={`relative gap-1.5 text-xs ${showFilters ? 'text-amber-400 bg-slate-700' : 'text-slate-400 hover:text-white'}`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search by name..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:bg-slate-700"
          />
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8">
                  <SelectValue placeholder="Region" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Regions</SelectItem>
                  {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8">
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  {DIFFICULTIES.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={maxDistance} onValueChange={setMaxDistance}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8">
                  <SelectValue placeholder="Max Distance" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Distance</SelectItem>
                  <SelectItem value="5">Up to 5 km</SelectItem>
                  <SelectItem value="10">Up to 10 km</SelectItem>
                  <SelectItem value="20">Up to 20 km</SelectItem>
                  <SelectItem value="30">Up to 30 km</SelectItem>
                </SelectContent>
              </Select>

              <Select value={maxDuration} onValueChange={setMaxDuration}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8">
                  <SelectValue placeholder="Max Duration" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Duration</SelectItem>
                  <SelectItem value="2">Up to 2 hrs</SelectItem>
                  <SelectItem value="4">Up to 4 hrs</SelectItem>
                  <SelectItem value="6">Up to 6 hrs</SelectItem>
                  <SelectItem value="8">Up to 8 hrs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8 flex-1">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Sort: Name A–Z</SelectItem>
                  <SelectItem value="distance">Sort: Shortest First</SelectItem>
                  <SelectItem value="duration">Sort: Quickest First</SelectItem>
                  <SelectItem value="difficulty">Sort: Easiest First</SelectItem>
                </SelectContent>
              </Select>

              {(activeFilterCount > 0 || sortBy !== 'name') && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-slate-400 hover:text-red-400 h-8 px-2 gap-1 text-xs">
                  <X className="w-3 h-3" /> Clear
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Walk list */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          <OfflineWalksBanner onWalkSelect={onWalkSelect} selectedWalk={selectedWalk} />

          {filteredWalks.length > 0 ? (
            filteredWalks.map(walk => (
              <WalkCard
                key={walk.id}
                walk={walk}
                isSelected={selectedWalk?.id === walk.id}
                onClick={() => onWalkSelect(walk)}
                accessible={accessibleMap[walk.id] ?? true}
              />
            ))
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Mountain className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No walks found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}