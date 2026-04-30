// Simple seesaw helper for oscillating values (demo/demo automation)
class Seesaw {
  constructor(freq = 0.5, amplitude = 1.0, offset = 0.0) {
    this.freq = freq;
    this.amp = amplitude;
    this.offset = offset;
    this.start = performance.now();
  }
  value(t = null) {
    const now = t === null ? performance.now() : t;
    const s = (now - this.start) / 1000;
    return this.offset + this.amp * Math.sin(2.0 * Math.PI * this.freq * s);
  }
}
// Export for reuse
window.Seesaw = Seesaw;