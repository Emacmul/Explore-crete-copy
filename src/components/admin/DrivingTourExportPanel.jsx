import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, AlertTriangle, CheckCircle2, FileDown } from 'lucide-react';
import { validateDrivingTour, generateGpx, generateKml, downloadTextFile } from '@/lib/routeExport';

/**
 * Export panel for Driving Audio Tours.
 *
 * Validates the route before export. Both GPX and KML are generated
 * from the same edited route data — the user never edits the route twice.
 */
export default function DrivingTourExportPanel({ form }) {
  const [errors, setErrors] = useState([]);

  const runValidation = () => {
    const errs = validateDrivingTour(form);
    setErrors(errs);
    return errs;
  };

  const handleExportGpx = () => {
    const errs = runValidation();
    if (errs.length > 0) return;
    const xml = generateGpx(form);
    downloadTextFile(xml, `${form.code || 'tour'}.gpx`, 'application/gpx+xml');
  };

  const handleExportKml = () => {
    const errs = runValidation();
    if (errs.length > 0) return;
    const xml = generateKml(form);
    downloadTextFile(xml, `${form.code || 'tour'}.kml`, 'application/vnd.google-earth.kml+xml');
  };

  const handleExportBoth = () => {
    const errs = runValidation();
    if (errs.length > 0) return;
    const gpx = generateGpx(form);
    const kml = generateKml(form);
    downloadTextFile(gpx, `${form.code || 'tour'}.gpx`, 'application/gpx+xml');
    setTimeout(() => {
      downloadTextFile(kml, `${form.code || 'tour'}.kml`, 'application/vnd.google-earth.kml+xml');
    }, 300);
  };

  const isValid = errors.length === 0;

  return (
    <div className="bg-slate-700/50 rounded-xl border border-purple-600/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <FileDown className="w-5 h-5 text-purple-400" />
        <h3 className="text-white font-semibold">Back Up Driving Audio Tour</h3>
      </div>
      <p className="text-slate-400 text-sm">
        Generate GPX and KML backup files from this route. Both use the same
        edited data — edit the route once, back up both formats.
      </p>

      {/* Validation status */}
      {errors.length > 0 && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-red-300 font-medium text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {errors.length} validation {errors.length === 1 ? 'error' : 'errors'} — fix before exporting
          </div>
          <ul className="text-red-300 text-xs space-y-1 pl-6 list-disc">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {isValid && errors.length === 0 && (
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Route validated — ready to back up.
        </div>
      )}

      {/* Backup buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Button
          onClick={handleExportGpx}
          className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
        >
          <Download className="w-4 h-4" /> Back Up GPX
        </Button>
        <Button
          onClick={handleExportKml}
          className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
        >
          <Download className="w-4 h-4" /> Back Up KML
        </Button>
        <Button
          onClick={handleExportBoth}
          className="bg-amber-500 hover:bg-amber-600 text-white gap-2"
        >
          <Download className="w-4 h-4" /> Back Up Both
        </Button>
      </div>

      <div className="text-xs text-slate-500 space-y-1">
        <p><span className="text-slate-400 font-medium">GPX:</span> Includes Segment ID, Segment Title, Waypoint Role, Colour and Average Segment Speed (where required).</p>
        <p><span className="text-slate-400 font-medium">KML:</span> One LineString for the full route + one Placemark per waypoint (lon, lat, elevation order). Suitable for VoiceMap, Google Earth and other KML apps.</p>
      </div>
    </div>
  );
}