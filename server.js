const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(__dirname)); // index.html 도 같이 서비스
app.get('/health', (_, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e6 });

const rooms = new Map();
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clean = (n) => String(n || '여행자').replace(/[<>&"'`]/g, '').trim().slice(0, 12) || '여행자';
const newCode = () => {
  let c;
  do { c = Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
};
const push = (r) => r.members.forEach((m, i) => {
  if (m.sid) io.to(m.sid).emit('room', { members: r.members.map((x) => ({ name: x.name })), me: i });
});
const findMember = (r, cid) => r && r.members.find((m) => m.cid === cid);

io.on('connection', (socket) => {
  const enter = (r, m) => {
    m.sid = socket.id; m.online = true; clearTimeout(m.timer);
    socket.data = { code: r.code, cid: m.cid };
    socket.join(r.code);
    socket.emit('joined', r.code);
    push(r);
  };

  socket.on('create', ({ cid, name }) => {
    if (!cid) return;
    const r = { code: newCode(), started: false, state: null, members: [] };
    const m = { cid, name: clean(name) };
    r.members.push(m); rooms.set(r.code, r); enter(r, m);
  });

  socket.on('join', ({ code, cid, name }) => {
    const r = rooms.get(String(code || '').toUpperCase());
    if (!r || !cid) return socket.emit('err', '존재하지 않는 방 코드입니다.');
    let m = findMember(r, cid);
    if (m) return enter(r, m);
    if (r.started) return socket.emit('err', '이미 시작된 게임입니다.');
    if (r.members.length >= 4) return socket.emit('err', '방이 가득 찼습니다. (최대 4명)');
    m = { cid, name: clean(name) };
    r.members.push(m); enter(r, m);
  });

  socket.on('rejoin', ({ code, cid }) => {
    const r = rooms.get(code);
    const m = findMember(r, cid);
    if (!m || m.left) return socket.emit('gone');
    enter(r, m);
    if (r.started && r.state) socket.emit('state', r.state);
  });

  socket.on('start', () => {
    const r = rooms.get(socket.data && socket.data.code);
    if (!r || r.started || r.members[0].cid !== socket.data.cid || r.members.length < 2) return;
    r.started = true;
    io.to(r.code).emit('game_started', { members: r.members.map((x) => ({ name: x.name })) });
  });

  socket.on('state', (st) => {
    const r = rooms.get(socket.data && socket.data.code);
    if (!r || !r.started || !st || !Array.isArray(st.players)) return;
    r.state = st;
    socket.to(r.code).emit('state', st);
  });

  socket.on('log', (msg) => {
    const r = rooms.get(socket.data && socket.data.code);
    if (r && r.started) socket.to(r.code).emit('log', String(msg).slice(0, 300));
  });

  socket.on('disconnect', () => {
    const r = rooms.get(socket.data && socket.data.code);
    const m = findMember(r, socket.data && socket.data.cid);
    if (!m || m.sid !== socket.id) return;
    m.online = false;
    if (!r.started) {
      r.members = r.members.filter((x) => x !== m);
      if (!r.members.length) rooms.delete(r.code); else push(r);
    } else {
      // 게임 중에는 60초 동안 재접속을 기다린 뒤 퇴장 처리
      m.timer = setTimeout(() => {
        m.left = true;
        io.to(r.code).emit('player_left', r.members.indexOf(m));
        if (r.members.every((x) => !x.online)) rooms.delete(r.code);
      }, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Bluemarble server on ' + PORT));
