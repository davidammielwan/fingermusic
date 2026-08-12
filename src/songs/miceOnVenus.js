// Decoded from the numbered play-along code "435 214 322 212", where
// 1-5 are the 5 keys of an A minor pentatonic run (A-C4-D4-E4-G4), not
// a straight major scale. The true tune's A sits at A3, a step below
// this app's playable range (C4-C5) — substituted with A4 here so the
// Practice Guide's auto-advance can actually trigger it, at the cost of
// those 2 notes playing a fifth higher than the original.
//
// `numbers` preserves the SOURCE tutorial's own 1-5 numbering (by
// pitch class: A=1, C=2, D=3, E=4, G=5) so the Practice Guide can
// display "435 214 322 212" exactly as the original video/comment did
// — this is deliberately separate from this app's own general 1-8
// finger-numbering system (NOTE_NUMBERS in fingers.js), which numbers
// all 8 playable notes in ascending pitch order and has no reason to
// match every external tutorial's own arbitrary convention.
export const MICE_ON_VENUS = {
  name: 'Mice on Venus',
  notes: ['E4', 'D4', 'G4', 'C4', 'A4', 'E4', 'D4', 'C4', 'C4', 'C4', 'A4', 'C4'],
  numbers: [4, 3, 5, 2, 1, 4, 3, 2, 2, 2, 1, 2],
};
