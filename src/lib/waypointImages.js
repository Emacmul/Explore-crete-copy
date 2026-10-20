// Shared by every waypoint editor (Walk/Hike, WalkAbout, Driving Tour) so photo handling behaves
// identically everywhere rather than being reimplemented per component.

export const MAX_WAYPOINT_IMAGES = 5;

// Compress an uploaded photo to max 1200px on the longest side, JPEG 85% quality — keeps file
// sizes reasonable for mobile data without the admin having to resize anything themselves first.
// Works for any format the browser can decode into an <img> (JPEG, PNG, etc.) — RAW files
// (.CR2/.CR3 etc.) and HEIC are not supported by browsers for this and will fail; admins should
// export JPEG.
export const compressImage = (file) => new Promise((resolve) => {
  const MAX = 1200;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// Reads a waypoint's photos as an array, regardless of whether it was saved under the current
// multi-photo field (`image_urls`) or the older single-photo field (`image_url`) that existed
// before this feature — so waypoints saved before this change still display correctly.
export function getWaypointImages(waypoint) {
  if (!waypoint) return [];
  if (Array.isArray(waypoint.image_urls) && waypoint.image_urls.length > 0) {
    return waypoint.image_urls;
  }
  if (waypoint.image_url) {
    return [waypoint.image_url];
  }
  return [];
}

// Reads a waypoint's photo captions as an array aligned BY INDEX to getWaypointImages —
// '' for any photo with no caption yet, and for any legacy waypoint without image_captions.
// Captions are short, optional text an admin enters under each reference photo; shown to
// customers (WalkDetail list + lightbox) and to narrators as read-only context, exactly
// like the photos themselves. Never longer than getWaypointImages(waypoint).
export function getWaypointCaptions(waypoint) {
  const images = getWaypointImages(waypoint);
  const raw = Array.isArray(waypoint && waypoint.image_captions) ? waypoint.image_captions : [];
  return images.map((_, i) => (typeof raw[i] === 'string' ? raw[i] : ''));
}

// Returns the full image_captions array after editing one caption at `index`.
export function setWaypointCaption(waypoint, index, value) {
  const captions = getWaypointCaptions(waypoint);
  captions[index] = value ?? '';
  return captions;
}

// Returns the new { image_urls, image_captions } pair after appending an uploaded photo —
// caption defaults to '' so the two arrays always stay the same length.
export function addWaypointImage(waypoint, url) {
  return {
    image_urls: [...getWaypointImages(waypoint), url],
    image_captions: [...getWaypointCaptions(waypoint), ''],
  };
}

// Returns the new { image_urls, image_captions } pair after removing the photo at `index`,
// keeping the two arrays aligned.
export function removeWaypointImage(waypoint, index) {
  return {
    image_urls: getWaypointImages(waypoint).filter((_, i) => i !== index),
    image_captions: getWaypointCaptions(waypoint).filter((_, i) => i !== index),
  };
}