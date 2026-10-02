export const PRESENTATION_SCHEMA_VERSION = 1;
export const PRESENTATION_STATES = ['login','checking','denied','unavailable'];
export function defaultPresentation() {
  const screens=Object.fromEntries(PRESENTATION_STATES.map(state=>[state,{serviceName:'',title:'',copy:'',logoAssetId:null,backgroundAssetId:null,layout:'center'}]));
  return {schemaVersion:1,version:0,widget:{visibility:'visible',variant:'compact',placement:'fixed',position:'top-right',margin:16,showName:true},theme:{mode:'dark',background:'#0b1020',surface:'#111a2b',text:'#f1f5f9',muted:'#a6b3c7',accent:'#5865f2',radius:16,size:'md'},screens,support:{url:null,label:'서비스 지원'}};
}
function object(value, keys) { if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!(key in value)))throw new Error('INVALID_PRESENTATION');return value; }
function choice(value, options){if(!options.includes(value))throw new Error('INVALID_PRESENTATION');return value;}
function text(value,max){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new Error('INVALID_PRESENTATION');return value;}
function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error('INVALID_PRESENTATION');return value;}
function asset(value){if(value!==null&&(typeof value!=='string'||!/^[-a-f0-9]{36}$/.test(value)))throw new Error('INVALID_ASSET');return value;}
function color(value){if(typeof value!=='string'||!/^#[\da-fA-F]{6}$/.test(value))throw new Error('INVALID_COLOR');return value.toLowerCase();}
function luminance(hex){const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function parsePresentation(value) {
  const p=object(value,['schemaVersion','version','widget','theme','screens','support']);choice(p.schemaVersion,[1]);integer(p.version,0,Number.MAX_SAFE_INTEGER);
  const w=object(p.widget,['visibility','variant','placement','position','margin','showName']);choice(w.visibility,['visible','hidden']);choice(w.variant,['button','compact','menu']);choice(w.placement,['inline','fixed','sticky']);choice(w.position,['top-left','top-right','bottom-left','bottom-right']);integer(w.margin,0,64);if(w.margin%4||typeof w.showName!=='boolean')throw new Error('INVALID_WIDGET');
  const t=object(p.theme,['mode','background','surface','text','muted','accent','radius','size']);choice(t.mode,['light','dark','system']);choice(t.radius,[8,12,16,24]);choice(t.size,['sm','md','lg']);
  const theme={...t};for(const key of ['background','surface','text','muted','accent'])theme[key]=color(t[key]);
  if(contrast(theme.text,theme.background)<4.5||contrast(theme.text,theme.surface)<4.5||contrast(theme.muted,theme.surface)<4.5||contrast('#ffffff',theme.accent)<4.5)throw new Error('INSUFFICIENT_CONTRAST');
  const s=object(p.screens,PRESENTATION_STATES),screens={};for(const state of PRESENTATION_STATES){const screen=object(s[state],['serviceName','title','copy','logoAssetId','backgroundAssetId','layout']);screens[state]={serviceName:text(screen.serviceName,80),title:text(screen.title,100),copy:text(screen.copy,500),logoAssetId:asset(screen.logoAssetId),backgroundAssetId:asset(screen.backgroundAssetId),layout:choice(screen.layout,['center','left'])};}
  const support=object(p.support,['url','label']);text(support.label,60);if(support.url!==null){if(typeof support.url!=='string'||support.url.length>2048)throw new Error('INVALID_SUPPORT');const u=new URL(support.url);if(u.protocol!=='https:'||u.username||u.password)throw new Error('INVALID_SUPPORT');}
  return {schemaVersion:1,version:p.version,widget:{...w},theme,screens,support:{...support}};
}
