// Downsamples the microphone to mono (16 kHz by default) and posts 100 ms chunks. Audio stays in memory only.
// The voice studio asks for 24 kHz with processorOptions {rate: 24000}.
class MicDownsampler extends AudioWorkletProcessor{
  constructor(options){super();const rate=options?.processorOptions?.rate||16000;this.ratio=sampleRate/rate;this.pos=0;this.size=Math.round(rate/10);this.buffer=new Float32Array(this.size);this.fill=0;}
  process(inputs){
    const input=inputs[0]?.[0];if(!input)return true;
    for(;this.pos<input.length;this.pos+=this.ratio){
      const i=Math.floor(this.pos),frac=this.pos-i,next=i+1<input.length?input[i+1]:input[i];
      this.buffer[this.fill++]=input[i]+(next-input[i])*frac;
      if(this.fill===this.buffer.length){this.port.postMessage(this.buffer);this.buffer=new Float32Array(this.size);this.fill=0;}
    }
    this.pos-=input.length;return true;
  }
}
registerProcessor('mic-downsampler',MicDownsampler);
