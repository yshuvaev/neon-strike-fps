// All sound is synthesized at runtime with WebAudio — no audio files.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this._noise = this._makeNoiseBuffer();
    this._startAmbient();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise;
    s.loop = true;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  _env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  shoot() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;

    // crack: filtered noise burst
    const n = this._noiseSrc();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
    const ng = this.ctx.createGain();
    n.connect(bp); bp.connect(ng); ng.connect(this.master);
    this._env(ng, t, 0.9, 0.004, 0.09);
    n.start(t); n.stop(t + 0.15);

    // body: pitch-dropping sine thump
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    const og = this.ctx.createGain();
    o.connect(og); og.connect(this.master);
    this._env(og, t, 0.7, 0.003, 0.12);
    o.start(t); o.stop(t + 0.2);

    // snap: short high noise
    const n2 = this._noiseSrc();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 5000;
    const ng2 = this.ctx.createGain();
    n2.connect(hp); hp.connect(ng2); ng2.connect(this.master);
    this._env(ng2, t, 0.35, 0.001, 0.03);
    n2.start(t); n2.stop(t + 0.05);
  }

  hit(headshot) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(headshot ? 980 : 640, t);
    o.frequency.exponentialRampToValueAtTime(headshot ? 480 : 320, t + 0.05);
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2400;
    o.connect(lp); lp.connect(g); g.connect(this.master);
    this._env(g, t, 0.22, 0.002, 0.06);
    o.start(t); o.stop(t + 0.1);
  }

  kill() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(340, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const g = this.ctx.createGain();
    o.connect(lp); lp.connect(g); g.connect(this.master);
    this._env(g, t, 0.35, 0.004, 0.26);
    o.start(t); o.stop(t + 0.35);
  }

  explosion() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;

    const n = this._noiseSrc();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.7);
    const ng = this.ctx.createGain();
    n.connect(lp); lp.connect(ng); ng.connect(this.master);
    this._env(ng, t, 1.0, 0.008, 0.75);
    n.start(t); n.stop(t + 0.9);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    const og = this.ctx.createGain();
    o.connect(og); og.connect(this.master);
    this._env(og, t, 0.9, 0.005, 0.65);
    o.start(t); o.stop(t + 0.8);
  }

  reload() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [0, 0.28].forEach((dt, i) => {
      const n = this._noiseSrc();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = i === 0 ? 900 : 1400; bp.Q.value = 3;
      const g = this.ctx.createGain();
      n.connect(bp); bp.connect(g); g.connect(this.master);
      this._env(g, t + dt, 0.3, 0.002, 0.05);
      n.start(t + dt); n.stop(t + dt + 0.08);
    });
  }

  dryFire() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const n = this._noiseSrc();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    const g = this.ctx.createGain();
    n.connect(hp); hp.connect(g); g.connect(this.master);
    this._env(g, t, 0.2, 0.001, 0.03);
    n.start(t); n.stop(t + 0.04);
  }

  hurt() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const g = this.ctx.createGain();
    o.connect(g); g.connect(this.master);
    this._env(g, t, 0.5, 0.004, 0.16);
    o.start(t); o.stop(t + 0.25);
  }

  enemyShot() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    o.connect(lp); lp.connect(g); g.connect(this.master);
    this._env(g, t, 0.16, 0.004, 0.18);
    o.start(t); o.stop(t + 0.25);
  }

  waveStart() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [110, 165, 220].forEach((f) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f * 1.005;
      const o2 = this.ctx.createOscillator();
      o2.type = 'sawtooth'; o2.frequency.value = f * 0.995;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3000, t);
      lp.frequency.exponentialRampToValueAtTime(200, t + 0.9);
      const g = this.ctx.createGain();
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master);
      this._env(g, t, 0.14, 0.01, 0.9);
      o.start(t); o2.start(t);
      o.stop(t + 1); o2.stop(t + 1);
    });
  }

  _startAmbient() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // low drone: two detuned sines + slow-filtered wind noise
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    g.connect(this.master);
    [55, 55 * 1.007, 82.4].forEach((f) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const og = this.ctx.createGain(); og.gain.value = 0.33;
      o.connect(og); og.connect(g);
      o.start(t);
    });
    const n = this._noiseSrc();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.5;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 140;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    const ng = this.ctx.createGain(); ng.gain.value = 0.35;
    n.connect(lp); lp.connect(ng); ng.connect(g);
    n.start(t); lfo.start(t);
    this.ambientGain = g;
  }
}
