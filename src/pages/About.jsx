import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';

export default function About() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-700 to-teal-900 p-6">
      <div className="w-full max-w-2xl mx-auto">
        <div className="text-center mb-8 pt-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4">
            <img src="/explore-crete-logo.png" alt="Explore Crete" className="w-11 h-11 object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-white">About Explore Crete</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-4 text-gray-700 leading-relaxed">
          <p>
            Explore Crete is a self-guided touring app for the island of Crete. It offers three
            kinds of experiences: walking and hiking routes through Crete's countryside and gorges,
            WalkAbouts — narrated audio tours through towns and villages that tell the history
            behind churches, ruins, and landmarks as you physically walk past them — and driving
            audio tours that narrate the countryside and points of interest as you drive between
            destinations.
          </p>
          <p>
            The app is built for travelers who want more than a map. Each route is paired with
            narration recorded by people who actually know the history, architecture, and stories
            behind what you're looking at, rather than a generic guidebook summary. Audio plays
            automatically as you reach each waypoint, whether that's a Byzantine church, a historic
            bridge, or a viewpoint over a gorge. A number of routes are free to try; others can be
            purchased individually, with an optional annual membership for people who want to
            explore more of the island over time.
          </p>
          <p>
            Explore Crete is built by Magical Crete, a small, Crete-based team led by a former
            walking guide with years of on-the-ground experience across the island's trails,
            archaeology, and history. Routes are researched, walked, and narrated firsthand, not
            assembled from secondhand sources.
          </p>

          <div className="pt-4 border-t flex flex-wrap items-center justify-between gap-3">
            <Link to="/Contact" className="inline-flex items-center gap-2 text-sm text-teal-700 font-medium hover:underline">
              <Mail className="w-4 h-4" />
              Contact us
            </Link>
            <Link to="/Login" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:underline">
              <ArrowLeft className="w-4 h-4" />
              Back to app
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
