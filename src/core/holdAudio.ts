/** A bounded utterance containing only samples captured during a deliberate hold. */
export class HoldAudio {
  private chunks: Float32Array[] = [];
  private length = 0;
  private speechSamples = 0;
  held = false;
  reset(held = false) { this.chunks = []; this.length = 0; this.speechSamples = 0; this.held = held; }
  push(samples: Float32Array) {
    if (!this.held || this.length >= 16000 * 30) return;
    const chunk = samples.slice(0, 16000 * 30 - this.length);
    let power = 0; for (const value of chunk) power += value * value;
    if (Math.sqrt(power / chunk.length) > .008) this.speechSamples += chunk.length;
    this.chunks.push(chunk); this.length += chunk.length;
  }
  release(): Float32Array[] {
    // Ignore accidental taps and silence; silence hallucinations should not send chat messages.
    const result = this.held && this.speechSamples >= 16000 * .12 ? this.chunks : [];
    this.reset(); return result;
  }
}
