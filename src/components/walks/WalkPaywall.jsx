import React from 'react';
import { Lock } from 'lucide-react';
import BuyButton from './BuyButton';

/**
 * WalkPaywall — shown in place of the full walk detail when the logged-in user hasn't
 * bought this walk and it isn't a free sample. Shows a teaser (description) + the price
 * and Buy button, but withholds the live route map, waypoints, GPX, and narration until
 * the purchase is recorded.
 */
export default function WalkPaywall({ walk }) {
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
        <Lock className="w-8 h-8 text-amber-600 mx-auto mb-2" />
        <h3 className="font-bold text-gray-900">This tour is part of the paid library</h3>
        <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">
          Buy this tour once to unlock the full route map, waypoints, safety notes and
          narration — then use it online or offline on your device.
        </p>
        <div className="mt-4 flex justify-center">
          <BuyButton walk={walk} size="lg" />
        </div>
        {!walk?.checkout_url && (
          <p className="text-xs text-gray-400 mt-2">Pricing for this tour is being prepared — check back soon.</p>
        )}
      </div>

      {walk?.description && (
        <div>
          <h3 className="font-semibold text-gray-900 mb-2">About this walk</h3>
          <p className="text-gray-600 text-sm leading-relaxed">{walk.description}</p>
        </div>
      )}
    </div>
  );
}