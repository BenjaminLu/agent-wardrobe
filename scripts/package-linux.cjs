// Linux build, run on Linux after npm ci:
//   dist/agent-wardrobe-linux-<arch>/                   the app folder (agent-wardrobe + resources/app, .desktop file, icon)
//   dist/agent-wardrobe-<version>-linux-<arch>.tar.gz
//   dist/Agent-Wardrobe-<version>-<arch>.AppImage       when appimagetool is on PATH or APPIMAGETOOL points at it
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const {root,copyApp,megabytes}=require('./package-common.cjs');
if(process.platform!=='linux')throw new Error('Linux packaging requires Linux (the Electron build in node_modules is per-platform)');
const {version,description}=require('../package.json');const arch=process.arch;const id='agent-wardrobe';
const dist=path.join(root,'dist'),output=path.join(dist,`${id}-linux-${arch}`);
fs.mkdirSync(dist,{recursive:true});fs.rmSync(output,{recursive:true,force:true});
fs.cpSync(path.join(root,'node_modules/electron/dist'),output,{recursive:true,verbatimSymlinks:true});
fs.renameSync(path.join(output,'electron'),path.join(output,id));fs.rmSync(path.join(output,'resources','default_app.asar'),{force:true});
copyApp(path.join(output,'resources','app'),{platform:'linux',arch});
// StartupWMClass matches Electron's WM_CLASS (package.json name), so docks group the window under this launcher.
const desktop=exec=>`[Desktop Entry]\nType=Application\nName=Agent Wardrobe\nComment=${description}\nExec=${exec} %U\nIcon=${id}\nTerminal=false\nCategories=Utility;\nStartupWMClass=${id}\n`;
fs.writeFileSync(path.join(output,`${id}.desktop`),desktop(path.join('/opt',id,id)));
fs.copyFileSync(path.join(root,'build','icon-256.png'),path.join(output,`${id}.png`));
const tarball=path.join(dist,`${id}-${version}-linux-${arch}.tar.gz`);fs.rmSync(tarball,{force:true});
execFileSync('tar',['-czf',tarball,'-C',dist,path.basename(output)],{stdio:'inherit'});
console.log(`${output} (${megabytes(output)})`);console.log(`${tarball} (${megabytes(tarball)})`);

const onPath=name=>String(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,name)).find(file=>fs.existsSync(file));
const appimagetool=process.env.APPIMAGETOOL||onPath('appimagetool')||onPath('appimagetool-x86_64.AppImage');
if(!appimagetool){console.warn('appimagetool not found (set APPIMAGETOOL); skipped the AppImage, the tar.gz is complete.');process.exit(0);}
const appDir=path.join(dist,`${id}.AppDir`);fs.rmSync(appDir,{recursive:true,force:true});
fs.cpSync(output,appDir,{recursive:true,verbatimSymlinks:true});fs.rmSync(path.join(appDir,`${id}.desktop`));
fs.writeFileSync(path.join(appDir,`${id}.desktop`),desktop(id));fs.copyFileSync(path.join(appDir,`${id}.png`),path.join(appDir,'.DirIcon'));
// An AppImage cannot carry a setuid chrome-sandbox. Chromium then needs unprivileged user namespaces; where the kernel or
// AppArmor (Ubuntu 23.10+) withholds them, start without the sandbox instead of crashing at launch.
fs.writeFileSync(path.join(appDir,'AppRun'),`#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
restricted=0
[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] && restricted=1
[ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ] && restricted=1
[ $restricted = 1 ] && set -- --no-sandbox "$@"
exec "$HERE/${id}" "$@"
`,{mode:0o755});
const image=path.join(dist,`Agent-Wardrobe-${version}-${arch==='x64'?'x86_64':arch==='arm64'?'aarch64':arch}.AppImage`);fs.rmSync(image,{force:true});
execFileSync(appimagetool,['--no-appstream',appDir,image],{stdio:'inherit',env:{...process.env,ARCH:arch==='x64'?'x86_64':arch==='arm64'?'aarch64':arch,APPIMAGE_EXTRACT_AND_RUN:'1'}});
fs.rmSync(appDir,{recursive:true,force:true});console.log(`${image} (${megabytes(image)})`);
