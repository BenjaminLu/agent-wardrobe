const { EventEmitter } = require('node:events');
const mods = require('./mods.cjs');
const {randomUUID}=require('node:crypto');
const DEFAULT_MOD='annie';
// Saved settings may name a character or skin that is no longer bundled (older versions shipped others): a missing
// character falls back to the default one with its defaults, a missing skin or persona to that character's own default.
function restoreSelection(catalog,saved={}){
  const mod=catalog.find(m=>m.id===saved?.modId)||catalog.find(m=>m.id===DEFAULT_MOD)||catalog[0];
  const same=mod.id===saved?.modId;
  const skin=(same&&mod.skins.find(s=>s.id===saved.skinId))||mod.skins.find(s=>s.id===mod.defaultSkin)||mod.skins[0];
  const persona=(same&&mod.personas.find(p=>p.id===saved.personaId))||mod.personas.find(p=>p.id===mod.defaultPersona)||mod.personas[0];
  return {modId:mod.id,skinId:skin.id,personaId:persona.id};
}
class Runtime extends EventEmitter {
  constructor(catalog, saved={}) {
    super(); this.catalog=catalog;if(!catalog.length)throw new Error('No Mods available');
    this.state={instanceId:randomUUID(),...restoreSelection(catalog,saved),provider:['codex','claude','local'].includes(saved?.provider)?saved.provider:'codex',activity:'idle',emotion:'neutral',speaking:false,revision:0};
  }
  snapshot() { const {mod,skin,persona}=mods.selection(this.catalog,this.state); return {...this.state,displayState:this.state.speaking?'speaking':this.state.activity,mod,skin,persona}; }
  publish() { this.state.revision++; const next=this.snapshot(); this.emit('change',next); return next; }
  select(value) {
    value=Object.fromEntries(Object.entries(value).filter(([key,v])=>['modId','skinId','personaId'].includes(key)&&v!==undefined));
    const candidate={...this.state,...value};
    if (value.modId && value.modId !== this.state.modId) {
      const mod=this.catalog.find(mod=>mod.id===value.modId); if(!mod)throw new Error('Unknown Mod');
      candidate.skinId=value.skinId||mod.defaultSkin; candidate.personaId=value.personaId||mod.defaultPersona;
    }
    mods.selection(this.catalog,candidate);
    this.state.modId=candidate.modId; this.state.skinId=candidate.skinId; this.state.personaId=candidate.personaId;
    return this.publish();
  }
  provider(value) { if(!['codex','claude','local'].includes(value))throw new Error('Unknown provider'); if(this.state.activity==='working'||this.state.activity==='waiting_for_approval')throw new Error('Wait for the current reply before switching engines'); this.state.provider=value; this.state.activity='idle'; this.state.emotion='neutral'; return this.publish(); }
  activity(value,emotion='neutral') { if(!mods.STATES.includes(value)||value==='speaking')throw new Error('Invalid activity'); this.state.activity=value; this.state.emotion=['neutral','smug','happy','surprised','nervous','sad'].includes(emotion)?emotion:'neutral'; return this.publish(); }
  speaking(on) { this.state.speaking=Boolean(on); return this.publish(); }
}
module.exports={Runtime,restoreSelection,DEFAULT_MOD};
