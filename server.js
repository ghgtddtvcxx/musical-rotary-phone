import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {spawn, execFile} from 'child_process';
import {fileURLToPath} from 'url';
import QRCode from 'qrcode';
import WebSocket,{WebSocketServer} from 'ws';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(); app.use(express.json({limit:'256kb'}));
const PORT=Number(process.env.PORT||3000), DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data'), STORE=path.join(DATA_DIR,'vodi.json');
const XRAY=process.env.XRAY_BIN||'xray', XRAY_PORT=Number(process.env.XRAY_LISTEN_PORT||10000), API_PORT=Number(process.env.XRAY_API_PORT||10085);
const DEFAULT_HOST=process.env.PUBLIC_DOMAIN||process.env.RAILWAY_PUBLIC_DOMAIN||'';
fs.mkdirSync(DATA_DIR,{recursive:true});
const empty={admin:{username:'admin',passwordHash:null},configs:[],settings:{publicHost:DEFAULT_HOST,wsPath:'/vless',port:443},meta:{version:3}};
function load(){try{return JSON.parse(fs.readFileSync(STORE,'utf8'))}catch{return structuredClone(empty)}}
let db=load();
if(!db.admin?.passwordHash) db.admin={username:'admin',passwordHash:hashPassword('admin')};
if(!db.settings) db.settings=empty.settings;
if(!db.settings.publicHost) db.settings.publicHost=DEFAULT_HOST;
if(!Array.isArray(db.configs)) db.configs=[];
if(db.configs.length===0){
  db.configs.push({id:crypto.randomBytes(9).toString('hex'),uuid:uuid(),name:'Vodi-Initial',volumeGB:null,days:null,createdAt:Date.now(),expiresAt:null,token:subToken(),enabled:true,expired:false});
}
function save(){const tmp=STORE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,STORE)}
save();
const sessions=new Map();
function token(){return crypto.randomBytes(32).toString('base64url')}
function hashPassword(p,salt=crypto.randomBytes(16).toString('hex')){return salt+':'+crypto.scryptSync(p,salt,64).toString('hex')}
function verify(p,stored){const [salt,h]=String(stored||'').split(':');if(!salt||!h)return false;const x=crypto.scryptSync(p,salt,64).toString('hex');return crypto.timingSafeEqual(Buffer.from(x),Buffer.from(h))}
function auth(req,res,next){const t=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const s=sessions.get(t);if(!s)return res.status(401).json({error:'جلسه منقضی شده است'});req.session=s;next()}
function uuid(){return crypto.randomUUID()}
function subToken(){return crypto.randomBytes(18).toString('base64url')}
function host(){return (db.settings.publicHost||process.env.PUBLIC_DOMAIN||process.env.RAILWAY_PUBLIC_DOMAIN||reqHostFallback()).replace(/^https?:\/\//,'').replace(/\/$/,'')}
function reqHostFallback(){return ''}
function link(c){const h=(db.settings.publicHost||process.env.PUBLIC_DOMAIN||process.env.RAILWAY_PUBLIC_DOMAIN||'').replace(/^https?:\/\//,'').replace(/\/$/,'');const q=new URLSearchParams({encryption:'none',security:'tls',type:'ws',host:h,path:db.settings.wsPath||'/vless',sni:h});return `vless://${c.uuid}@${h}:443?${q.toString()}#${encodeURIComponent(c.name)}`}
function human(bytes){if(bytes===null||bytes===undefined)return '0 B';const u=['B','KB','MB','GB','TB'];let n=Number(bytes),i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return `${n<10&&i>1?n.toFixed(1):n.toFixed(0)} ${u[i]}`}
function xrayConfig(){return {log:{loglevel:'warning'},api:{services:['StatsService'],'tag':'api'},stats:{},policy:{levels:{'0':{statsUserUplink:true,statsUserDownlink:true,statsUserOnline:true,handshake:60,connIdle:300,uplinkOnly:0,downlinkOnly:0,bufferSize:4}}},inbounds:[{tag:'api',listen:'127.0.0.1',port:API_PORT,protocol:'dokodemo-door',settings:{address:'127.0.0.1'}},{tag:'vless-ws',listen:'127.0.0.1',port:XRAY_PORT,protocol:'vless',settings:{clients:db.configs.filter(c=>c.enabled!==false&&!c.expired).map(c=>({id:c.uuid,email:c.id,level:0})),decryption:'none'},streamSettings:{network:'ws',security:'none',wsSettings:{path:db.settings.wsPath||'/vless'}}}],outbounds:[{tag:'direct',protocol:'freedom'}],routing:{rules:[{type:'field',inboundTag:['api'],outboundTag:'api'}]}}}
let xray=null, rebuilding=false;
function writeXray(){const cfg=path.join(DATA_DIR,'xray.json');fs.writeFileSync(cfg,JSON.stringify(xrayConfig(),null,2));return cfg}
function restartXray(){if(rebuilding)return;rebuilding=true;const cfg=writeXray();if(xray){try{xray.kill('SIGTERM')}catch{}};xray=spawn(XRAY,['run','-config',cfg],{stdio:['ignore','pipe','pipe']});xray.stdout.on('data',d=>process.stdout.write('[xray] '+d));xray.stderr.on('data',d=>process.stderr.write('[xray] '+d));xray.on('exit',()=>{xray=null});setTimeout(()=>{rebuilding=false},700)}
if(fs.existsSync(process.env.XRAY_BIN||'/opt/xray/xray')) restartXray();
async function stats(){return new Promise(resolve=>{execFile(XRAY,['api','statsquery','--server',`127.0.0.1:${API_PORT}`],{timeout:2500},(err,stdout)=>{if(err)return resolve({});try{const j=JSON.parse(stdout);const out={};for(const s of j.stat||[]){const m=s.name.match(/^user>>>(.+?)>>>traffic>>>(uplink|downlink)$/);if(m){out[m[1]]??={up:0,down:0};out[m[1]][m[2]==='uplink'?'up':'down']=Number(s.value)||0}}resolve(out)}catch{resolve({})}})})}
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'vodi-vpn',xray:Boolean(xray),protocol:'VLESS',transport:'WebSocket'}));
app.post('/api/login',(req,res)=>{const {username,password}=req.body||{};if(username!=='admin'||!verify(password,db.admin.passwordHash))return res.status(401).json({error:'نام کاربری یا رمز عبور اشتباه است'});const t=token();sessions.set(t,{created:Date.now()});res.json({token:t})});
app.post('/api/logout',auth,(req,res)=>{const t=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');sessions.delete(t);res.json({ok:true})});
app.post('/api/change-password',auth,(req,res)=>{const {currentPassword,newPassword,confirmPassword}=req.body||{};if(!verify(currentPassword,db.admin.passwordHash))return res.status(400).json({error:'رمز فعلی اشتباه است'});if(!newPassword||newPassword.length<6)return res.status(400).json({error:'رمز جدید باید حداقل ۶ کاراکتر باشد'});if(newPassword!==confirmPassword)return res.status(400).json({error:'تکرار رمز جدید یکسان نیست'});db.admin.passwordHash=hashPassword(newPassword);save();sessions.clear();res.json({ok:true})});
app.get('/api/bootstrap',auth,async(req,res)=>{const st=await stats();const configs=db.configs.map(c=>({...c,link:link(c),usedBytes:(st[c.id]?.up||0)+(st[c.id]?.down||0)}));res.json({settings:{...db.settings,publicHost:host()},configs,nodes:[{id:'railway-xray',name:'Railway Xray',status:xray?'online':'offline'}]})});
app.post('/api/settings',auth,(req,res)=>{const {publicHost,wsPath}=req.body||{};if(publicHost!==undefined){const h=String(publicHost).trim().replace(/^https?:\/\//,'').replace(/\/$/,'');if(!/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(h))return res.status(400).json({error:'دامنه نامعتبر است'});db.settings.publicHost=h}if(wsPath!==undefined){const p=String(wsPath);if(!p.startsWith('/'))return res.status(400).json({error:'مسیر WebSocket باید با / شروع شود'});db.settings.wsPath=p}save();restartXray();res.json({ok:true})});
app.post('/api/configs',auth,(req,res)=>{const {name,volumeGB,days}=req.body||{};if(!name)return res.status(400).json({error:'نام کانفیگ را وارد کنید'});const volume=volumeGB===''||volumeGB===null||volumeGB===undefined?null:Number(volumeGB);const d=days===''||days===null||days===undefined?null:Number(days);if(volume!==null&&(!Number.isFinite(volume)||volume<=0))return res.status(400).json({error:'حجم نامعتبر است'});if(d!==null&&(!Number.isFinite(d)||d<=0))return res.status(400).json({error:'مدت نامعتبر است'});const c={id:crypto.randomBytes(9).toString('hex'),uuid:uuid(),name:String(name).trim(),volumeGB:volume,days:d,createdAt:Date.now(),expiresAt:d?Date.now()+d*86400000:null,token:subToken(),enabled:true,expired:false};db.configs.unshift(c);save();restartXray();res.status(201).json({...c,link:link(c)})});
app.patch('/api/configs/:id',auth,(req,res)=>{const c=db.configs.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:'کانفیگ پیدا نشد'});const {enabled,name,volumeGB,days}=req.body||{};if(enabled!==undefined)c.enabled=Boolean(enabled);if(name!==undefined&&String(name).trim())c.name=String(name).trim();if(volumeGB!==undefined)c.volumeGB=volumeGB===null||volumeGB===''?null:Number(volumeGB);if(days!==undefined){c.days=days===null||days===''?null:Number(days);c.expiresAt=c.days?Date.now()+c.days*86400000:null}save();restartXray();res.json({...c,link:link(c)})});
app.delete('/api/configs/:id',auth,(req,res)=>{const n=db.configs.length;db.configs=db.configs.filter(x=>x.id!==req.params.id);if(db.configs.length===n)return res.status(404).json({error:'کانفیگ پیدا نشد'});save();restartXray();res.json({ok:true})});
app.post('/api/configs/:id/reset',auth,(req,res)=>{const c=db.configs.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:'کانفیگ پیدا نشد'});execFile(XRAY,['api','statsquery','--server',`127.0.0.1:${API_PORT}`],()=>{});c.resetAt=Date.now();c.baseUsed=0;save();res.json({ok:true})});
app.get('/api/configs/:id/qr',auth,async(req,res)=>{const c=db.configs.find(x=>x.id===req.params.id);if(!c)return res.sendStatus(404);res.type('png').send(await QRCode.toBuffer(link(c),{width:520,margin:2}));});
function subData(c){const l=link(c);return Buffer.from(l+'\n').toString('base64')}
app.get('/sub/:token',async(req,res)=>{const c=db.configs.find(x=>x.token===req.params.token);if(!c)return res.status(404).send('Not found');const st=await stats();const up=st[c.id]?.up||0,down=st[c.id]?.down||0,total=c.volumeGB?Math.round(c.volumeGB*1024*1024*1024):0;res.set('profile-title',`Vodi VPN • ${c.name}`);res.set('subscription-userinfo',`upload=${up}; download=${down}; total=${total}; expire=${c.expiresAt?Math.floor(c.expiresAt/1000):0}`);res.type('text/plain').send(subData(c))});
app.get('/sub/:token/page',(req,res)=>{const c=db.configs.find(x=>x.token===req.params.token);if(!c)return res.status(404).send('Not found');res.sendFile(path.join(__dirname,'dist','index.html'))});
app.use(express.static(path.join(__dirname,'dist')));
const server=app.listen(PORT,()=>console.log(`Vodi VPN on ${PORT}`));
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{try{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!==(db.settings.wsPath||'/vless'))return socket.destroy();wss.handleUpgrade(req,socket,head,ws=>{const upstream=new WebSocket(`ws://127.0.0.1:${XRAY_PORT}${u.pathname}`,{headers:{'x-forwarded-host':req.headers.host}});const close=()=>{try{ws.close()}catch{}try{upstream.close()}catch{}};upstream.on('open',()=>{ws.on('message',d=>{if(upstream.readyState===1)upstream.send(d)});upstream.on('message',d=>{if(ws.readyState===1)ws.send(d)});ws.on('close',close);ws.on('error',close);upstream.on('close',close);upstream.on('error',close)});upstream.on('error',close)})}catch{socket.destroy()}});
setInterval(async()=>{const st=await stats();let changed=false;for(const c of db.configs){const used=(st[c.id]?.up||0)+(st[c.id]?.down||0);c.usedBytes=used;if(c.volumeGB&&used>=c.volumeGB*1024**3&&c.enabled){c.enabled=false;changed=true}if(c.expiresAt&&Date.now()>=c.expiresAt&&!c.expired){c.expired=true;c.enabled=false;changed=true}}if(changed){save();restartXray()}},15000);
