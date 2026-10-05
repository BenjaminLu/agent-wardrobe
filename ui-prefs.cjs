// Pure preference rules shared by startup, IPC and the node tests.
const UI_LANGUAGES=['auto','en','zh-TW','zh-CN','ja'];
const THEMES=['ocean','mint','sakura','dark'];
const sanitizeUiLanguage=value=>UI_LANGUAGES.includes(value)?value:'auto';
const sanitizeTheme=value=>THEMES.includes(value)?value:'ocean';
function resolveLanguage(uiLanguage,systemLanguages=[]){
  const choice=sanitizeUiLanguage(uiLanguage);
  return choice==='auto'?(systemLanguages[0]||'en'):choice;
}
function defaultVoice(language){
  return language.startsWith('zh')?(/Hans|CN|SG/i.test(language)?'Tingting':'Eddy (Chinese (Taiwan))'):language.startsWith('ja')?'Kyoko':'Samantha';
}
function startupPrefs(saved,systemLanguages){
  const uiLanguage=sanitizeUiLanguage(saved.uiLanguage),theme=sanitizeTheme(saved.theme);
  const language=resolveLanguage(uiLanguage,systemLanguages);
  return {uiLanguage,theme,language,voice:defaultVoice(language)};
}
function applyUiPrefs(settings,data={},systemLanguages=[]){
  const uiLanguage=UI_LANGUAGES.includes(data.uiLanguage)?sanitizeUiLanguage(data.uiLanguage):settings.uiLanguage;
  const theme=THEMES.includes(data.theme)?sanitizeTheme(data.theme):settings.theme;
  const languageChanged=uiLanguage!==settings.uiLanguage,themeChanged=theme!==settings.theme;
  const next={...settings,uiLanguage,theme};
  if(languageChanged){next.language=resolveLanguage(uiLanguage,systemLanguages);next.voice=defaultVoice(next.language);}
  return {settings:next,languageChanged,themeChanged};
}
function uiApplyReady({chatBusy,toolTask,taskRunning,activity}){
  return !chatBusy&&!toolTask&&!taskRunning&&!['working','waiting_for_approval'].includes(activity);
}
module.exports={UI_LANGUAGES,THEMES,resolveLanguage,defaultVoice,sanitizeUiLanguage,sanitizeTheme,startupPrefs,applyUiPrefs,uiApplyReady};
