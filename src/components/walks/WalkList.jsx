import React, { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Mountain, SlidersHorizontal, X, RefreshCw, Baby, Church, ChevronLeft, ChevronRight } from 'lucide-react';
import WalkCard from './WalkCard';
import OfflineWalksBanner from '../offline/OfflineWalksBanner';
import { getTourCategory } from '../../lib/tourCategories';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LANGUAGE_NAME_BY_CODE, getTourLanguage } from '@/lib/i18n';

const REGIONS = ['Chania', 'Rethymno', 'Heraklion', 'Lasithi'];
const DIFFICULTIES = ['easy', 'moderate', 'challenging', 'difficult'];
// Per Enda (follow-up 177): the "All walks" list used to just keep growing in one long
// scroll. Now it's split into pages of 5, with Previous/Next controls appearing once
// there's more than one page.
const PAGE_SIZE = 5;

export default function WalkList({ walks, selectedWalk, onWalkSelect, searchQuery, onSearchChange, onRefresh, refreshing, tourCategoryCode, onFilteredChange }) {
  const { t, lang } = useLanguage();
  const uiLangName = LANGUAGE_NAME_BY_CODE[lang] || 'English';
  const pluralLabel = t('tour.' + getTourCategory(tourCategoryCode).code + '.plural');
  const [showFilters, setShowFilters] = useState(false);
  const [region, setRegion] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  const [maxDistance, setMaxDistance] = useState('all');
  const [maxDuration, setMaxDuration] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [page, setPage] = useState(1);
  // Per Enda/Anoushka (follow-up 144): a dedicated, always-visible toggle rather than
  // something buried in the Filters panel, so a parent looking for a buggy-suitable
  // route doesn't have to go hunting for it. Originally Walks and Hikes (WHT) only;
  // widened to WalkAbouts (WBT) too (2026-09-14) — a WalkAbout is still done on foot,
  // so the same need applies there. Driving Tours (DDV) don't get this — you're not
  // pushing a buggy from a car.
  const [buggyFriendlyOnly, setBuggyFriendlyOnly] = useState(false);
  const showBuggyFriendlyToggle = tourCategoryCode === 'WHT' || tourCategoryCode === 'WBT';
  // Per Enda (follow-up 145): WalkAbouts (WBT) only. main_interest is a comma-separated
  // string of up to 3 tags (see the admin editor's "Main Interests" picker) — "Routes of
  // Faith" is one of the existing tag options, now surfaced to customers as its own chip.
  const [routeOfFaithOnly, setRouteOfFaithOnly] = useState(false);
  const showRouteOfFaithToggle = tourCategoryCode === 'WBT';
  const hasRouteOfFaith = (walk) =>
    (walk.main_interest || '').split(',').map(s => s.trim()).includes('Routes of Faith');

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
      const matchesBuggyFriendly = !showBuggyFriendlyToggle || !buggyFriendlyOnly || walk.buggy_friendly === true;
      const matchesRouteOfFaith = !showRouteOfFaithToggle || !routeOfFaithOnly || hasRouteOfFaith(walk);
      return matchesSearch && matchesRegion && matchesDifficulty && matchesDistance && matchesDuration && matchesBuggyFriendly && matchesRouteOfFaith;
    })
    .sort((a, b) => {
      // Prefer tours narrated in the chosen UI language: matching tours float to the top,
      // the rest follow. Within each group the user's chosen sort still applies.
      const aMatch = getTourLanguage(a) === uiLangName ? 0 : 1;
      const bMatch = getTourLanguage(b) === uiLangName ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      if (sortBy === 'distance') return (a.distance_km || 0) - (b.distance_km || 0);
      if (sortBy === 'duration') return (a.duration_hours || 0) - (b.duration_hours || 0);
      if (sortBy === 'difficulty') {
        const order = { easy: 0, moderate: 1, challenging: 2, difficult: 3 };
        return (order[a.difficulty] ?? 1) - (order[b.difficulty] ?? 1);
      }
      return (a.name || '').localeCompare(b.name || '');
    });

  // Per Enda's report: toggling Buggy-Friendly (or any other filter/search) narrowed
  // THIS list, but a walk already open in the detail panel on the right — or shown on
  // the map — stayed there even once it no longer matched the filter, and the map
  // itself never respected these filters at all (it always showed the whole category).
  // Home.jsx owns the detail panel and the map, and has no visibility into this
  // component's own filter state, so it's reported up here: whenever the actual SET of
  // matching walks changes, the parent finds out and can drop a now-filtered-out
  // selection back to the map, and show only these walks there.
  //
  // Compared by a joined-ids STRING, not the `filteredWalks` array itself, because that
  // array is a brand new reference every render (this component isn't memoized) even
  // when its contents haven't actually changed — using the array reference as the
  // effect's dependency would fire this on every render, and since the parent's own
  // state update triggers a re-render here too, that would loop forever. The string is
  // only a different VALUE when the actual matching set changes, so the effect (and the
  // parent update it causes) only ever fires when something real changed.
  const filteredIds = filteredWalks.map(w => w.id).join(',');
  useEffect(() => {
    onFilteredChange?.(filteredWalks);
  }, [filteredIds]);

  // Jump back to page 1 whenever the tour type, search text, or any filter changes —
  // otherwise switching filters could leave you stranded on a page number that no
  // longer makes sense for the new, shorter or reordered result set.
  useEffect(() => {
    setPage(1);
  }, [tourCategoryCode, searchQuery, region, difficulty, maxDistance, maxDuration, sortBy, buggyFriendlyOnly, routeOfFaithOnly]);

  const totalPages = Math.max(1, Math.ceil(filteredWalks.length / PAGE_SIZE));
  // Guard against being left on a page that no longer exists (e.g. a walk was removed
  // by an admin and the list shrank), without needing an extra render just to correct it.
  const currentPage = Math.min(page, totalPages);
  const pagedWalks = filteredWalks.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b bg-gradient-to-r from-slate-800 to-slate-900">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <img src="/explore-crete-logo.png" alt="Explore Crete" className="w-9 h-9 rounded-lg object-contain" />
            <div>
              <h2 className="font-bold text-white">{t('list.all', { label: pluralLabel })}</h2>
              <p className="text-xs text-slate-400">{t('list.countOf', { n: filteredWalks.length, total: walks.length, label: pluralLabel })}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={refreshing}
                title={t('list.refreshTitle')}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 border border-blue-400 rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {t('list.refresh')}
              </button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFilters(f => !f)}
              className={`relative gap-1.5 text-xs ${showFilters ? 'text-amber-400 bg-slate-700' : 'text-slate-400 hover:text-white'}`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              {t('list.filters')}
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
            placeholder={t('list.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:bg-slate-700"
          />
        </div>

        {/* Buggy-Friendly quick toggle — Walks/Hikes and WalkAbouts, always visible (not
            tucked inside the Filters panel) so it's never something a parent has to go
            looking for. */}
        {showBuggyFriendlyToggle && (
          <button
            type="button"
            onClick={() => setBuggyFriendlyOnly(v => !v)}
            aria-pressed={buggyFriendlyOnly}
            className={`mt-2 flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors ${
              buggyFriendlyOnly
                ? 'bg-amber-500 border-amber-400 text-white'
                : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <Baby className="w-3.5 h-3.5" />
            {t('list.buggyFriendly')}
          </button>
        )}

        {/* Route of Faith quick toggle — WalkAbouts only, same always-visible treatment
            as the Buggy-Friendly one above, per Enda's follow-up 145 request. */}
        {showRouteOfFaithToggle && (
          <button
            type="button"
            onClick={() => setRouteOfFaithOnly(v => !v)}
            aria-pressed={routeOfFaithOnly}
            className={`mt-2 flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors ${
              routeOfFaithOnly
                ? 'bg-amber-500 border-amber-400 text-white'
                : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <Church className="w-3.5 h-3.5" />
            {t('list.routeOfFaith')}
          </button>
        )}

        {/* Filters panel */}
        {showFilters && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8">
                  <SelectValue placeholder={t('list.region')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('list.allRegions')}</SelectItem>
                  {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8">
                  <SelectValue placeholder={t('list.difficulty')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('list.allLevels')}</SelectItem>
                  {DIFFICULTIES.map(d => <SelectItem key={d} value={d} className="capitalize">{t('diff.' + d)}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={maxDistance} onValueChange={setMaxDistance}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8">
                  <SelectValue placeholder={t('list.anyDistance')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('list.anyDistance')}</SelectItem>
                  <SelectItem value="5">{t('list.upToKm', { n: 5 })}</SelectItem>
                  <SelectItem value="10">{t('list.upToKm', { n: 10 })}</SelectItem>
                  <SelectItem value="20">{t('list.upToKm', { n: 20 })}</SelectItem>
                  <SelectItem value="30">{t('list.upToKm', { n: 30 })}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={maxDuration} onValueChange={setMaxDuration}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8">
                  <SelectValue placeholder={t('list.anyDuration')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('list.anyDuration')}</SelectItem>
                  <SelectItem value="2">{t('list.upToHrs', { n: 2 })}</SelectItem>
                  <SelectItem value="4">{t('list.upToHrs', { n: 4 })}</SelectItem>
                  <SelectItem value="6">{t('list.upToHrs', { n: 6 })}</SelectItem>
                  <SelectItem value="8">{t('list.upToHrs', { n: 8 })}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white text-xs h-8 flex-1">
                  <SelectValue placeholder={t('list.sortBy')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">{t('list.sortName')}</SelectItem>
                  <SelectItem value="distance">{t('list.sortDistance')}</SelectItem>
                  <SelectItem value="duration">{t('list.sortDuration')}</SelectItem>
                  <SelectItem value="difficulty">{t('list.sortDifficulty')}</SelectItem>
                </SelectContent>
              </Select>

              {(activeFilterCount > 0 || sortBy !== 'name') && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-slate-400 hover:text-red-400 h-8 px-2 gap-1 text-xs">
                  <X className="w-3 h-3" /> {t('list.clear')}
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

          {pagedWalks.length > 0 ? (
            pagedWalks.map(walk => (
              <WalkCard
                key={walk.id}
                walk={walk}
                isSelected={selectedWalk?.id === walk.id}
                onClick={() => onWalkSelect(walk)}
                accessible={walk._accessible ?? true}
              />
            ))
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Mountain className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">{t('list.noWalksTitle')}</p>
              <p className="text-sm">{t('list.noWalksHint')}</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Previous/Next paging — only appears once there's more than one page. On page 1
          only "Next page" shows; on the last page only "Previous" shows; any page in
          between shows both. Per Enda (follow-up 177). */}
      {totalPages > 1 && (
        <div className={`flex items-center border-t bg-white px-4 py-2 ${currentPage > 1 ? 'justify-between' : 'justify-end'}`}>
          {currentPage > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(currentPage - 1)}
              className="text-xs gap-1 text-slate-600 hover:text-slate-900"
            >
              <ChevronLeft className="w-4 h-4" />
              {t('list.previousPage')}
            </Button>
          )}
          {currentPage < totalPages && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(currentPage + 1)}
              className="text-xs gap-1 text-slate-600 hover:text-slate-900"
            >
              {t('list.nextPage')}
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}