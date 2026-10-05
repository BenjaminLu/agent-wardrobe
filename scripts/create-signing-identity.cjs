// Creates a local self-signed code-signing identity in the login keychain.
// Ad-hoc signatures pin macOS privacy grants (Accessibility, Screen Recording) to one build's cdhash;
// a stable certificate keeps those grants across `npm run package:mac` rebuilds on this Mac.
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');const {randomBytes}=require('node:crypto');
const NAME='Agent Wardrobe Local Signing';
if(process.platform!=='darwin')throw new Error('Code signing identities require macOS');
const existing=execFileSync('/usr/bin/security',['find-certificate','-a','-c',NAME],{encoding:'utf8'});
if(existing.includes(NAME)){console.log(`${NAME} already exists`);process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wardrobe-sign-'));const file=name=>path.join(dir,name);
const password=randomBytes(18).toString('base64url');
try{
  fs.writeFileSync(file('openssl.cnf'),`[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ext\n[dn]\nCN=${NAME}\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n`);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','3650','-keyout',file('key.pem'),'-out',file('cert.pem'),'-config',file('openssl.cnf')],{stdio:'ignore'});
  // macOS `security import` cannot read OpenSSL 3's default PKCS#12 encryption.
  execFileSync('openssl',['pkcs12','-export','-legacy','-inkey',file('key.pem'),'-in',file('cert.pem'),'-out',file('identity.p12'),'-passout','pass:'+password],{stdio:'ignore'});
  execFileSync('/usr/bin/security',['import',file('identity.p12'),'-k',path.join(os.homedir(),'Library/Keychains/login.keychain-db'),'-P',password,'-T','/usr/bin/codesign'],{stdio:'inherit'});
  console.log(`Created ${NAME}`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
