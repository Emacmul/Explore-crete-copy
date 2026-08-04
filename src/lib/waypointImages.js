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
