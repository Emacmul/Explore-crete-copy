import { translateWalkField, stillMatchesMaster } from '@/lib/fieldTranslation';

// Translate untouched walk-clone text only; never replace a narrator's corrections.
export default async function prepareWalkingWaypoints({ walk, master, apiKeys, authPayload }) {
  const waypoints = (walk.waypoints || []).map(wp => ({ ...wp }));
  const errors = [];
  if (!master || !walk.clone_of || !walk.target_language || walk.target_language.toLowerCase() === 'english' || walk.finished) return { waypoints, errors };
  for (let index = 0; index < waypoints.length; index += 1) {
    for (const field of ['name', 'description']) {
      if (!stillMatchesMaster(waypoints[index][field], master.waypoints?.[index]?.[field])) continue;
      try {
        waypoints[index][field] = await translateWalkField({ field, waypointIndex: index, walkId: walk.id, targetLanguage: walk.target_language, apiKeys, authPayload });
      } catch (error) {
        errors.push(`${waypoints[index].segment_id || `Waypoint ${index + 1}`} ${field}: ${error?.response?.data?.error || error.message}`);
      }
    }
  }
  return { waypoints, errors };
}