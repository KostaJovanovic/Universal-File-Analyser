/* Optional per-sample captions for the /samples gallery.
   ============================================================================
   The generator (tools/prerender-samples.mjs) auto-derives each sample's label
   and caption from the format catalog. To override the caption for a specific
   file - a nicer "what this shows" line - add an entry here, keyed by the exact
   filename (case-sensitive) as it sits in the samples/ folder.

   House style: British spelling, no em-dashes (use a spaced hyphen " - "), one
   short plain sentence. Entirely optional - a missing entry just falls back to
   the catalog description, with no warning.
   ============================================================================ */
export const SAMPLE_PAGES = {
  // 'sunset.cr2': 'Canon R5 RAW - full EXIF, RAW decode, histogram and palette.',
  // 'voice-memo.m4a': 'iPhone voice memo - waveform, spectrogram and loudness.',
};
