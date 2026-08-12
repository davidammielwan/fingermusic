export class PracticeGuide {
  constructor(song) {
    this.song = song;
    this.reset();
  }

  reset() {
    this.index = 0;
    this.loops = 0;
    this._previousActive = new Set();
  }

  get currentNote() {
    return this.song.notes[this.index];
  }

  getUpcoming(count) {
    const upcoming = [];
    for (let i = 0; i < count; i++) {
      upcoming.push(this.song.notes[(this.index + i) % this.song.notes.length]);
    }
    return upcoming;
  }

  // Parallel to getUpcoming, but for the source tutorial's own numbering
  // (song.numbers), when the song data provides one. null for a step a
  // song doesn't annotate — callers should fall back to the general
  // NOTE_NUMBERS labeling in that case.
  getUpcomingNumbers(count) {
    const upcoming = [];
    for (let i = 0; i < count; i++) {
      upcoming.push(this.song.numbers?.[(this.index + i) % this.song.notes.length] ?? null);
    }
    return upcoming;
  }

  // Piano mode reports currently-held notes every frame, so a sustained
  // pinch would otherwise re-trigger on every frame it stays active —
  // only notes newly present since the last check count as a play.
  checkActiveNotes(activeNotes) {
    const currentActive = new Set(activeNotes);
    const newlyActive = [...currentActive].filter((note) => !this._previousActive.has(note));
    this._previousActive = currentActive;

    if (!newlyActive.includes(this.currentNote)) return false;

    this.index++;
    if (this.index >= this.song.notes.length) {
      this.index = 0;
      this.loops++;
    }
    return true;
  }
}
