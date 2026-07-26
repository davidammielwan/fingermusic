// voiceId scopes calls to an independent internal voice (e.g. one per
// tracked hand) so multiple simultaneous controllers — like each hand's
// own pitch bend — don't stomp on each other. Defaults to a single
// shared voice for simple callers that don't care.
export class Instrument {
  noteOn(note, velocity = 1, voiceId = 'default') {
    throw new Error('noteOn not implemented');
  }

  noteOff(note, voiceId = 'default') {
    throw new Error('noteOff not implemented');
  }

  setParam(name, value, voiceId = 'default') {
    throw new Error('setParam not implemented');
  }

  dispose() {
    throw new Error('dispose not implemented');
  }
}
