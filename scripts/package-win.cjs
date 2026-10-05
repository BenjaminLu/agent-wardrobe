// Windows build, run on Windows after npm ci and npm run build:native:
//   dist/Agent Wardrobe-win32-<arch>/           the app folder (Agent Wardrobe.exe + resources/app)
//   dist/Agent-Wardrobe-<version>-win-<arch>.zip  portable: unzip anywhere and run
//   dist/Agent-Wardrobe-Setup-<version>-<arch>.exe  per-user NSIS installer (no admin prompt), when makensis is installed
// Signing is optional: WINDOWS_CERTIFICATE_FILE (+ WINDOWS_CERTIFICATE_PASSWORD) for a .pfx, or AZURE_SIGNING_DLIB and
// AZURE_SIGNING_METADATA for Azure Trusted Signing. Unsigned builds work; SmartScreen warns on first run (see README).
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const {root,copyApp,megabytes}=require('./package-common.cjs');
if(process.platform!=='win32')throw new Error('Windows packaging requires Windows (the Electron build in node_modules is per-platform)');
const {version}=require('../package.json');const arch=process.arch;const name='Agent Wardrobe';
const dist=path.join(root,'dist'),output=path.join(dist,`${name}-win32-${arch}`),exe=path.join(output,`${name}.exe`);
fs.mkdirSync(dist,{recursive:true});fs.rmSync(output,{recursive:true,force:true});
fs.cpSync(path.join(root,'node_modules/electron/dist'),output,{recursive:true});
fs.renameSync(path.join(output,'electron.exe'),exe);fs.rmSync(path.join(output,'resources','default_app.asar'),{force:true});
copyApp(path.join(output,'resources','app'),{platform:'win32',arch});
fs.copyFileSync(path.join(root,'build','icon.ico'),path.join(output,'resources','app','build','icon.ico'));

const signtool=()=>{
  if(process.env.SIGNTOOL)return process.env.SIGNTOOL;
  const kits=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Windows Kits','10','bin');
  const found=fs.existsSync(kits)?fs.readdirSync(kits).filter(v=>/^10\./.test(v)).sort().reverse().map(v=>path.join(kits,v,'x64','signtool.exe')).find(f=>fs.existsSync(f)):null;
  if(!found)throw new Error('signtool.exe not found; install the Windows SDK or set SIGNTOOL');return found;
};
const signing=process.env.WINDOWS_CERTIFICATE_FILE?['/f',process.env.WINDOWS_CERTIFICATE_FILE,...(process.env.WINDOWS_CERTIFICATE_PASSWORD?['/p',process.env.WINDOWS_CERTIFICATE_PASSWORD]:[]),'/tr','http://timestamp.digicert.com']
  :process.env.AZURE_SIGNING_DLIB&&process.env.AZURE_SIGNING_METADATA?['/dlib',process.env.AZURE_SIGNING_DLIB,'/dmdf',process.env.AZURE_SIGNING_METADATA,'/tr','http://timestamp.acs.microsoft.com']:null;
// Secrets stay out of the log: signtool's own output is kept, the command line is not echoed.
const sign=files=>{if(signing&&files.length)execFileSync(signtool(),['sign','/fd','SHA256','/td','SHA256',...signing,...files],{stdio:'inherit'});};

(async()=>{
  await brand(exe,version);
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  if(signing)sign(walk(output).filter(f=>/\.(exe|dll|node)$/i.test(f)));else console.warn('Unsigned build: set WINDOWS_CERTIFICATE_FILE or AZURE_SIGNING_DLIB/AZURE_SIGNING_METADATA to sign.');
  // Windows' own bsdtar writes zip archives (-a picks the format from the extension).
  const zip=path.join(dist,`Agent-Wardrobe-${version}-win-${arch}.zip`);fs.rmSync(zip,{force:true});
  execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe'),['-a','-c','-f',zip,'-C',dist,path.basename(output)],{stdio:'inherit'});
  console.log(`${output} (${megabytes(output)})`);console.log(`${zip} (${megabytes(zip)})`);
  const makensis=[process.env.MAKENSIS,path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','NSIS','makensis.exe'),path.join(process.env.ProgramFiles||'C:\\Program Files','NSIS','makensis.exe')].find(f=>f&&fs.existsSync(f));
  if(!makensis){console.warn('makensis not found (install NSIS 3); skipped the installer, the zip is complete.');return;}
  const setup=path.join(dist,`Agent-Wardrobe-Setup-${version}-${arch}.exe`),script=path.join(dist,'installer.nsi');
  fs.writeFileSync(script,installer({version,source:output,setup,icon:path.join(root,'build','icon.ico')}));
  execFileSync(makensis,['/V2',script],{stdio:'inherit'});fs.rmSync(script,{force:true});
  sign([setup]);console.log(`${setup} (${megabytes(setup)})`);
})().catch(error=>{console.error(error.message);process.exit(1);});

// Icon and version info in the executable's PE resources, with resedit (pure JS, so no Wine or extra binaries are needed).
async function brand(file,version){
  const {NtExecutable,NtExecutableResource,Data,Resource}=await import('resedit');
  const executable=NtExecutable.from(fs.readFileSync(file),{ignoreCert:true}),resources=NtExecutableResource.from(executable);
  const [group]=Resource.IconGroupEntry.fromEntries(resources.entries);
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group?group.id:1,group?group.lang:1033,Data.IconFile.from(fs.readFileSync(path.join(root,'build','icon.ico'))).icons.map(icon=>icon.data));
  const [info]=Resource.VersionInfo.fromEntries(resources.entries);const [major,minor,patch]=version.split(/[.-]/).map(Number);
  info.setStringValues({lang:1033,codepage:1200},{ProductName:name,FileDescription:name,CompanyName:'Agent Wardrobe contributors',LegalCopyright:'Apache-2.0',OriginalFilename:`${name}.exe`,InternalName:name,FileVersion:version,ProductVersion:version});
  info.setFileVersion(major,minor,patch,0,1033);info.setProductVersion(major,minor,patch,0,1033);info.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);fs.writeFileSync(file,Buffer.from(executable.generate()));
  const check=NtExecutableResource.from(NtExecutable.from(fs.readFileSync(file),{ignoreCert:true}));
  if(Resource.IconGroupEntry.fromEntries(check.entries)[0]?.icons.length!==Data.IconFile.from(fs.readFileSync(path.join(root,'build','icon.ico'))).icons.length)throw new Error('App icon was not written');
}
// Per-user install into a fixed %LOCALAPPDATA%\Programs folder: no UAC prompt, and the uninstaller only ever removes that folder.
function installer({version,source,setup,icon}){
  const key='Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentWardrobe';
  return `Unicode true
!include "MUI2.nsh"
Name "${name}"
OutFile "${setup}"
InstallDir "$LOCALAPPDATA\\Programs\\${name}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "${icon}"
!define MUI_UNICON "${icon}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\\${name}.exe"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "TradChinese"
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "Japanese"
Section
  nsExec::Exec 'taskkill /IM "${name}.exe" /F'
  RMDir /r "$INSTDIR\\resources"
  SetOutPath "$INSTDIR"
  File /r "${source}\\*.*"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\\${name}.lnk" "$INSTDIR\\${name}.exe"
  WriteRegStr HKCU "${key}" "DisplayName" "${name}"
  WriteRegStr HKCU "${key}" "DisplayVersion" "${version}"
  WriteRegStr HKCU "${key}" "Publisher" "Agent Wardrobe contributors"
  WriteRegStr HKCU "${key}" "DisplayIcon" "$INSTDIR\\${name}.exe"
  WriteRegStr HKCU "${key}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${key}" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
  WriteRegDWORD HKCU "${key}" "NoModify" 1
  WriteRegDWORD HKCU "${key}" "NoRepair" 1
SectionEnd
Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${name}.exe" /F'
  Delete "$SMPROGRAMS\\${name}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${key}"
SectionEnd
`;
}
