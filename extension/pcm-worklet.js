class PcmCollector extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.remaining = options.processorOptions.frames;
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || this.remaining <= 0) return this.remaining > 0;
    for (let frame = 0; frame < channels[0].length && this.remaining > 0; frame++) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame] / channels.length;
      this.buffer[this.offset++] = sample;
      this.remaining--;
      if (this.offset === this.buffer.length || this.remaining === 0) {
        const chunk = this.buffer.slice(0, this.offset);
        this.port.postMessage({ chunk, done: this.remaining === 0 }, [chunk.buffer]);
        this.offset = 0;
      }
    }
    return this.remaining > 0;
  }
}
registerProcessor('pcm-collector', PcmCollector);
