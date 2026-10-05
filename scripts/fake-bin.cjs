// Smoke stand-ins for command-line tools (codex, a Laya python): a shell script on macOS / Linux, an npm-style .cmd
// shim on Windows (platform.cjs starts its script with Node directly). Returns the path to hand to the app.
const fs=require('node:fs');const path=require('node:path');
function fakeBin(dir,name,script){
  if(process.platform==='win32'){const bin=path.join(dir,`${name}.cmd`);fs.writeFileSync(bin,`@ECHO off\r\nSET dp0=%~dp0\r\n"${process.execPath}" "%dp0%\\${path.relative(dir,script)}" %*\r\n`);return bin;}
  const bin=path.join(dir,name);fs.writeFileSync(bin,`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${script}" "$@"\n`,{mode:0o755});return bin;
}
module.exports={fakeBin};
