const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const allowedOrigins = new Set([process.env.FRONTEND_ORIGIN || 'https://beemo911.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080']);
const token = () => crypto.randomBytes(24).toString('hex');
const send = (res, status, data) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
const code = () => { let value; do { value = [...crypto.randomBytes(6)].map(b => alphabet[b % alphabet.length]).join(''); } while (rooms.has(value)); return value; };
const readBody = req => new Promise((resolve, reject) => { let raw=''; req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) reject(new Error('Request too large')); }); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });
const teamFor = (room, key) => key && room.players.red === key ? 'red' : key && room.players.blue === key ? 'blue' : null;
const getRoom = (key, res) => { const room = rooms.get(String(key || '').toUpperCase()); if (!room) send(res,404,{error:'Комната не найдена: возможно, сервер перезапустился.'}); return room; };
const turnFor = current => { const step=current?.step; if (current?.done || step == null) return null; if (step<8) return {type:'ban',team:step%2?'blue':'red'}; if (step<18) return {type:'pick',team:(step-8)%2?'blue':'red'}; return null; };
function pickHero(room, hero) {
  const current=room.state.current, turn=turnFor(current);
  if (!turn) return 'Драфт уже завершён.';
  if (!current.pool?.includes(hero)) return 'Героя нет в пуле этой игры.';
  if ([...current.bans.red,...current.bans.blue,...current.picks.red,...current.picks.blue].includes(hero)) return 'Этот герой уже выбран.';
  current[turn.type+'s'][turn.team].push(hero); current.step++;
  if (current.step===18) { current.done=true; room.state.games.push({picks:{red:[...current.picks.red],blue:[...current.picks.blue]},bans:{red:[...current.bans.red],blue:[...current.bans.blue]},date:new Date().toLocaleDateString('ru-RU')}); room.state.banPool=[...new Set([...(room.state.banPool||[]),...current.bans.red,...current.bans.blue])]; if(room.state.games.length%3===0) room.state.banPool=[]; }
  return null;
}
const server = http.createServer(async (req,res) => {
  const url=new URL(req.url, 'http://localhost'), origin=req.headers.origin;
  if(origin && allowedOrigins.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try {
    if(req.method==='GET' && url.pathname==='/healthz') return send(res,200,{ok:true,service:'dota-draft-room'});
    if(req.method==='GET' && url.pathname==='/') { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); return fs.createReadStream(path.join(__dirname,'index.html')).pipe(res); }
    if(req.method==='POST' && url.pathname==='/api/rooms') { const body=await readBody(req); if(!body.state?.current) return send(res,400,{error:'Не удалось подготовить драфт.'}); const roomCode=code(), red=token(); rooms.set(roomCode,{state:body.state,players:{red,blue:null},updated:Date.now()}); return send(res,201,{code:roomCode,token:red,team:'red',state:body.state}); }
    if(req.method==='POST' && url.pathname==='/api/join') { const body=await readBody(req), room=getRoom(body.code,res); if(!room)return; const existing=teamFor(room,body.token); if(existing)return send(res,200,{code:String(body.code).toUpperCase(),token:body.token,team:existing,state:room.state}); if(room.players.blue)return send(res,409,{error:'В комнате уже есть два игрока.'}); const blue=token(); room.players.blue=blue; room.updated=Date.now(); return send(res,200,{code:String(body.code).toUpperCase(),token:blue,team:'blue',state:room.state}); }
    if(req.method==='GET' && url.pathname==='/api/state') { const room=getRoom(url.searchParams.get('code'),res); if(!room)return; const team=teamFor(room,url.searchParams.get('token')); if(!team)return send(res,403,{error:'Нет доступа к этой комнате.'}); return send(res,200,{state:room.state,players:{red:!!room.players.red,blue:!!room.players.blue},updated:room.updated}); }
    if(req.method==='POST' && url.pathname==='/api/action') { const body=await readBody(req),room=getRoom(body.code,res); if(!room)return; const team=teamFor(room,body.token),turn=turnFor(room.state.current); if(!team)return send(res,403,{error:'Нет доступа к этой комнате.'}); if(!turn||team!==turn.team)return send(res,409,{error:'Сейчас ход другой команды.'}); const error=pickHero(room,body.hero); if(error)return send(res,409,{error}); room.updated=Date.now(); return send(res,200,{state:room.state}); }
    if(req.method==='POST' && url.pathname==='/api/next') { const body=await readBody(req),room=getRoom(body.code,res); if(!room)return; if(teamFor(room,body.token)!=='red')return send(res,403,{error:'Только игрок за Свет может начать следующую игру.'}); if(!room.state.current?.done||!body.state?.current||body.state.current.step!==0)return send(res,409,{error:'Новая игра пока недоступна.'}); room.state=body.state; room.updated=Date.now(); return send(res,200,{state:room.state}); }
    return send(res,404,{error:'Маршрут не найден.'});
  } catch(e) { return send(res,400,{error:e.message||'Bad request'}); }
});
server.listen(PORT,'0.0.0.0',()=>console.log('Draft Room server listening on '+PORT));
