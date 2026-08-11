import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';

export default function Contact() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-700 to-teal-900 p-6">
      <div className="w-full max-w-2xl mx-auto">
        <div className="text-center mb-8 pt-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4">
            <img src="/explore-crete-logo.png" alt="Explore Crete" className="w-11 h-11 object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-white">Contact Us</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-4 text-gray-700 leading-relaxed">
          <p>
            Have a question about a walk, a WalkAbout, or a driving tour — or found something
            that doesn't seem right in the app? Get in touch and we'll get back to you.
          </p>

          <a
            href="mailto:enda@magicalcrete.com"
            className="flex items-center gap-3 bg-teal-50 rounded-xl p-4 text-teal-800 font-medium hover:bg-teal-100 transition-colors"
          >
            <Mail className="w-5 h-5 shrink-0" />
            enda@magicalcrete.com
          </a>

          <div className="pt-4 border-t flex flex-wrap items-center justify-between gap-3">
            <Link to="/About" className="text-sm text-teal-700 font-medium hover:underline">
              About Explore Crete
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
