// Generated stand-in "speech" for tests: voiced syllables (a few harmonics, wobbling pitch) with short gaps and a
// pause every few seconds, so the quality check and the slicer see something shaped like a person reading.
const {encodeWav}=require('../../../voice-audio.cjs');
function speechLike(seconds,{rate=24000,level=.3,pauseEvery=2.5,pause=.45,seed=1}={}){
  const out=new Float32Array(Math.round(seconds*rate));let rnd=seed;const random=()=>(rnd=(rnd*16807)%2147483647)/2147483647;
  let t=0,sinceBreak=0;
  while(t<out.length){
    const syllable=Math.round((.15+random()*.15)*rate),f0=140+random()*120;
    for(let i=0;i<syllable&&t+i<out.length;i++){
      const env=Math.sin(Math.PI*i/syllable),f=f0*(1+.05*Math.sin(2*Math.PI*3*i/rate)),ph=2*Math.PI*f*i/rate;
      out[t+i]=level*env*(.6*Math.sin(ph)+.25*Math.sin(2*ph)+.15*Math.sin(3*ph));
    }
    t+=syllable+Math.round(.05*rate);sinceBreak+=syllable/rate+.05;
    if(sinceBreak>=pauseEvery){t+=Math.round(pause*rate);sinceBreak=0;}
  }
  return out;
}
const speechWav=(seconds,options={})=>encodeWav(speechLike(seconds,options),options.rate||24000);
module.exports={speechLike,speechWav};
