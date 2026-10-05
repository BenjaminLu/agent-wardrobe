// Typeless (a third-party dictation app) as the recogniser after the wake word. It has no API: the app taps
// Typeless's own shortcut (Fn) to start, watches the microphone for the end of the question, taps Fn again,
// and Typeless pastes the text into the focused chat box. Only the shortcut setting is read from Typeless.
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');

function typelessStatus({home=os.homedir(),app='/Applications/Typeless.app'}={}){
  const installed=fs.existsSync(app);let shortcut=null;
  try{shortcut=JSON.parse(fs.readFileSync(path.join(home,'Library','Application Support','Typeless','app-settings.json'),'utf8')).featureShortcutBindings?.dictationMode?.[0]||null;}catch{}
  // Only a lone Fn tap can be sent reliably; other shortcuts would need their own key mapping.
  return {installed,shortcut,supported:installed&&(shortcut===null||shortcut==='Fn')};
}

// End of an utterance from 100 ms microphone chunks: speech is louder than the noise floor heard so far;
// after speech, a pause ends it. Returns 'done', 'nothing' (no speech in time) or null (keep listening).
class SpeechEnd{
  constructor({silenceMs=1200,noSpeechMs=7000,maxMs=25000,minLevel=.012}={}){Object.assign(this,{silenceMs,noSpeechMs,maxMs,minLevel});this.elapsed=0;this.noise=null;this.heard=false;this.quiet=0;}
  accept(samples){
    let sum=0;for(const v of samples)sum+=v*v;const rms=Math.sqrt(sum/Math.max(1,samples.length)),ms=samples.length/16;
    // The noise floor starts low (the user may already be talking) and only learns from quiet chunks.
    this.elapsed+=ms;this.noise??=Math.min(rms,this.minLevel);
    const speech=rms>Math.max(this.minLevel,this.noise*3);if(!speech)this.noise=this.noise*.9+rms*.1;
    if(speech){this.heard=true;this.quiet=0;}else if(this.heard)this.quiet+=ms;
    if(this.heard&&this.quiet>=this.silenceMs)return 'done';
    if(!this.heard&&this.elapsed>=this.noSpeechMs)return 'nothing';
    if(this.elapsed>=this.maxMs)return this.heard?'done':'nothing';
    return null;
  }
}
module.exports={typelessStatus,SpeechEnd};
