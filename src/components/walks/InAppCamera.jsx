import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Camera that lives INSIDE the tour player (Enda, 2026-11-18).
 *
 * Opening the phone's own camera app used to take the customer off the Explore Crete
 * screen entirely — on many Android phones the browser tab is then discarded and there is
 * no way back to the running tour, so the tour (and its GPS position) was lost just for
 * taking a photo. This overlay keeps the app itself in the foreground: a live viewfinder
 * from getUserMedia, a shutter, and the photos collected on screen until they're saved to
 * the device. Nothing about the tour is paused or torn down here — the player keeps its
 * GPS watch, its position and its narration exactly as they were, so closing this puts the
 * customer straight back into the tour with no "Resume narration" hoop to jump through.
 *
 * The stream is VIDEO ONLY on purpose: asking for audio would take the phone's audio focus
 * away from the narration.
 */
export default function InAppCamera({ onClose, t }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const urlsRef = useRef([]);
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('unsupported');
        return;
      }
      try {
        // Ask for the largest frame the phone will hand over. Android Chrome honours this
        // and takePhoto() below then returns full sensor resolution; iOS Safari caps the
        // in-app stream at 1080p whatever we ask for.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => { /* autoplay blocked — the preview just stays dark */ });
        }
      } catch (e) {
        if (!cancelled) setError(e?.name === 'NotAllowedError' ? 'denied' : 'failed');
      }
    };

    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current = [];
    };
  }, []);

  const capture = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    let blob = null;

    // ImageCapture.takePhoto() grabs a still straight off the sensor — full resolution on
    // the phones that support it (Chrome on Android). Everywhere else (iOS Safari has no
    // ImageCapture) we fall back to a frame off the live preview.
    if (track && typeof window.ImageCapture === 'function') {
      try {
        const still = new window.ImageCapture(track);
        if (typeof still.takePhoto === 'function') blob = await still.takePhoto();
      } catch {
        blob = null;
      }
    }

    if (!blob) {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    }

    if (!blob) return;
    const name = `explore-crete-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    const url = URL.createObjectURL(blob);
    urlsRef.current.push(url);
    setPhotos((prev) => [...prev, { name, url, blob }]);
  }, []);

  // Phone: the share sheet (which offers "Save to Photos"). Desktop / no share support:
  // a normal download per photo, so the shots always end up somewhere the customer can
  // find them.
  const save = useCallback(async () => {
    if (!photos.length || saving) return;
    setSaving(true);
    try {
      const files = photos.map((p) => new File([p.blob], p.name, { type: 'image/jpeg' }));
      if (navigator.canShare?.({ files })) {
        try {
          await navigator.share({ files, title: t('camera.title') });
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
        }
      }
      for (const p of photos) {
        const a = document.createElement('a');
        a.href = p.url;
        a.download = p.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      setSaving(false);
    }
  }, [photos, saving, t]);

  return (
    <div className="fixed inset-0 z-[1200] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <span className="text-white font-semibold">
          {t('camera.title')}{photos.length > 0 ? ` · ${photos.length}` : ''}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-white hover:bg-white/10"
          title={t('camera.close')}
        >
          <X className="w-6 h-6" />
        </Button>
      </div>

      <div className="relative flex-1 bg-black overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-white text-sm">
              {t(error === 'denied' ? 'camera.denied' : 'camera.unsupported')}
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {/* Enda (2026-11-19): the old white/80 hairline text over a bright viewfinder was
            effectively invisible outdoors. This is the one thing on this screen the customer
            MUST read (their tour is still running underneath), so it now sits on the app's
            amber warning colour, bold and dark-on-orange — the same colour as the Pause
            button, so it reads as "the app is still doing something". */}
        <div className="absolute top-0 left-0 right-0 flex justify-center p-3 pointer-events-none">
          <p className="max-w-md rounded-lg bg-amber-500 px-3 py-2 text-center text-sm font-bold leading-snug text-amber-950 shadow-lg shadow-black/40">
            {t('camera.keepOpen')}
          </p>
        </div>
      </div>

      <div className="bg-black/80 px-4 pt-3 pb-4 space-y-3">
        {photos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((p) => (
              <img
                key={p.name}
                src={p.url}
                alt=""
                className="h-14 w-14 shrink-0 rounded-md object-cover border border-white/30"
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="w-24 text-xs text-white/70">
            {photos.length > 0 ? t('camera.count', { n: photos.length }) : ''}
          </div>
          <button
            type="button"
            onClick={capture}
            disabled={!!error}
            aria-label={t('camera.shutter')}
            title={t('camera.shutter')}
            className="w-20 h-20 rounded-full bg-white ring-4 ring-white/40 active:scale-95 transition disabled:opacity-40"
          />
          <div className="w-24 flex justify-end">
            {photos.length > 0 && (
              <Button
                onClick={save}
                disabled={saving}
                className="gap-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Download className="w-4 h-4" /> {t('camera.save')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}