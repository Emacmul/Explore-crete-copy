// Writing direction of tour CONTENT (not of the app chrome).
//
// A translation clone stores its narration language as a NAME on
// Walk.target_language ("Hebrew", "Arabic"). Everywhere else in the app that same
// language may appear as its UI code ("he", "ar"), so both are accepted here.
// Masters have no target_language and are English — always left-to-right.
const RTL_NAMES = ['hebrew', 'arabic'];
const RTL_CODES = ['he', 'ar'];

export function isRtlLanguage(language) {
  const v = String(language || '').trim().toLowerCase();
  if (!v) return false;
  return RTL_NAMES.includes(v) || RTL_CODES.includes(v);
}