// ================================================
// TOFAS Pro Exam System - Complete Single File
// Run: npm install express mongoose socket.io bcryptjs jsonwebtoken cors
// Then: node app.js
// ================================================

const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

// ---------- CONFIG ----------
const PORT = process.env.PORT || 5000;
const MONGODB_URI = 'mongodb://localhost:27017/tofas_pro';
const JWT_SECRET = 'tofas_super_secret_key_2024';

// ---------- MODELS ----------
const studentSchema = new mongoose.Schema({
    fullName: String,
    username: { type: String, unique: true },
    password: String,
    internalId: String,
    status: { type: String, default: 'active' },
    lastLogin: Date
});
studentSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});
studentSchema.methods.comparePassword = function(pwd) { return bcrypt.compare(pwd, this.password); };
const Student = mongoose.model('Student', studentSchema);

const adminSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    role: { type: String, default: 'admin' }
});
adminSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});
adminSchema.methods.comparePassword = function(pwd) { return bcrypt.compare(pwd, this.password); };
const Admin = mongoose.model('Admin', adminSchema);

const levelSchema = new mongoose.Schema({
    name: String,
    description: String,
    isOpen: { type: Boolean, default: true }
});
const Level = mongoose.model('Level', levelSchema);

const examSchema = new mongoose.Schema({
    title: String,
    description: String,
    level: { type: mongoose.Schema.Types.ObjectId, ref: 'Level' },
    examPassword: String,
    duration: Number,
    totalQuestions: Number,
    status: { type: String, default: 'closed' },
    shuffleQuestions: Boolean,
    resultsAnnounced: { type: Boolean, default: false }
});
const Exam = mongoose.model('Exam', examSchema);

const questionSchema = new mongoose.Schema({
    questionText: String,
    questionType: { type: String, default: 'mcq' },
    options: [{ text: String, isCorrect: Boolean }],
    level: { type: mongoose.Schema.Types.ObjectId, ref: 'Level' }
});
const Question = mongoose.model('Question', questionSchema);

const resultSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
    answers: [{
        questionId: mongoose.Schema.Types.ObjectId,
        selectedAnswer: String,
        isCorrect: Boolean
    }],
    totalScore: Number,
    percentage: Number,
    status: { type: String, default: 'pending' }
});
const Result = mongoose.model('Result', resultSchema);

const violationSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
    type: String,
    timestamp: { type: Date, default: Date.now }
});
const Violation = mongoose.model('Violation', violationSchema);

const notificationSchema = new mongoose.Schema({
    to: String,
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    message: String,
    createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

// ---------- EXPRESS SETUP ----------
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Serve static if needed (but we will use inline HTML)
app.use(express.static(path.join(__dirname, 'public')));

// ---------- AUTH MIDDLEWARE ----------
function protect(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
        return res.status(401).json({ message: 'No token' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        req.userRole = decoded.role;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid token' });
    }
}

// ---------- SOCKET.IO ----------
io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);
    socket.on('join-exam', (data) => {
        socket.join(`exam-${data.examId}`);
    });
    socket.on('violation', (data) => {
        // save violation
        const decoded = jwt.verify(data.token, JWT_SECRET);
        Violation.create({ student: decoded.id, exam: data.examId, type: data.type });
        io.to('admin-room').emit('new-violation', data);
    });
    socket.on('join-admin', () => socket.join('admin-room'));
});

// ---------- API ROUTES ----------
// Auth
app.post('/api/auth/student/login', async (req, res) => {
    const { username, password } = req.body;
    const student = await Student.findOne({ username });
    if (!student) return res.status(401).json({ message: 'بيانات خاطئة' });
    if (student.status !== 'active') return res.status(403).json({ message: 'حساب موقوف' });
    const match = await student.comparePassword(password);
    if (!match) return res.status(401).json({ message: 'بيانات خاطئة' });
    student.lastLogin = new Date();
    await student.save();
    const token = jwt.sign({ id: student._id, role: 'student' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, student: { id: student._id, fullName: student.fullName, username: student.username } });
});

app.post('/api/auth/admin/login', async (req, res) => {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ message: 'بيانات خاطئة' });
    const match = await admin.comparePassword(password);
    if (!match) return res.status(401).json({ message: 'بيانات خاطئة' });
    const token = jwt.sign({ id: admin._id, role: admin.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, admin: { id: admin._id, username, role: admin.role } });
});

// Students (admin)
app.get('/api/students', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const students = await Student.find().select('-password');
    res.json(students);
});
app.post('/api/students', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const student = await Student.create(req.body);
    res.json(student);
});
app.put('/api/students/:id', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true }).select('-password');
    res.json(student);
});

// Levels
app.get('/api/levels', protect, async (req, res) => {
    const levels = await Level.find();
    res.json(levels);
});
app.post('/api/levels', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const level = await Level.create(req.body);
    res.json(level);
});

// Exams
app.get('/api/exams/student', protect, async (req, res) => {
    if (req.userRole !== 'student') return res.status(403).json({});
    const exams = await Exam.find({ status: { $in: ['open', 'scheduled'] } }).populate('level');
    res.json(exams);
});
app.get('/api/exams', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const exams = await Exam.find().populate('level');
    res.json(exams);
});
app.post('/api/exams', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const exam = await Exam.create(req.body);
    res.json(exam);
});
app.put('/api/exams/:id', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const exam = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(exam);
});
app.post('/api/exams/:id/verify-password', protect, async (req, res) => {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.json({ success: false });
    if (exam.examPassword === req.body.password) res.json({ success: true });
    else res.json({ success: false });
});

// Questions
app.get('/api/questions', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const questions = await Question.find().populate('level');
    res.json(questions);
});
app.post('/api/questions', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const q = await Question.create(req.body);
    res.json(q);
});

// Results
app.get('/api/results/student', protect, async (req, res) => {
    if (req.userRole !== 'student') return res.status(403).json({});
    const results = await Result.find({ student: req.userId, status: 'announced' }).populate('exam', 'title');
    res.json(results);
});
app.get('/api/results', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const results = await Result.find().populate('student', 'fullName username').populate('exam', 'title');
    res.json(results);
});
app.post('/api/results/announce/:examId', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    await Result.updateMany({ exam: req.params.examId, status: 'reviewed' }, { status: 'announced' });
    await Exam.findByIdAndUpdate(req.params.examId, { resultsAnnounced: true });
    res.json({ message: 'تم الإعلان' });
});

// Notifications
app.get('/api/notifications/student', protect, async (req, res) => {
    if (req.userRole !== 'student') return res.status(403).json({});
    const notifs = await Notification.find({ $or: [{ to: 'all' }, { student: req.userId }] }).sort('-createdAt');
    res.json(notifs);
});
app.post('/api/notifications', protect, async (req, res) => {
    if (req.userRole === 'student') return res.status(403).json({});
    const notif = await Notification.create(req.body);
    res.json(notif);
});

// ---------- INLINE HTML PAGES ----------
function getStudentLoginPage() {
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تسجيل دخول الطالب</title>
<style>body{font-family:sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.card{background:white;padding:2rem;border-radius:16px;width:90%;max-width:400px;text-align:center}
input{width:100%;padding:12px;margin:8px 0;border:2px solid #e2e8f0;border-radius:8px}
button{width:100%;padding:12px;background:#667eea;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer}
.error{color:red}</style></head><body><div class="card"><h2>🔐 TOFAS Pro</h2>
<input id="username" placeholder="اسم المستخدم (9 أرقام)"><input id="password" type="password" placeholder="كلمة المرور">
<button onclick="login()">تسجيل الدخول</button><p class="error" id="error"></p></div>
<script>
async function login(){
    const u=document.getElementById('username').value,p=document.getElementById('password').value;
    const res=await fetch('/api/auth/student/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const data=await res.json();
    if(res.ok){localStorage.setItem('token',data.token);localStorage.setItem('student',JSON.stringify(data.student));window.location.href='/student/dashboard';}
    else document.getElementById('error').textContent=data.message;
}
</script></body></html>`;
}

function getStudentDashboard(student) {
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>لوحة الطالب</title>
<style>body{margin:0;font-family:sans-serif;background:#f8fafc}
.sidebar{width:240px;background:#1e293b;color:white;height:100vh;position:fixed;right:0;padding:1.5rem}
.sidebar a{color:#cbd5e1;text-decoration:none;display:block;padding:0.7rem;border-radius:8px;margin-bottom:0.3rem}
.main{margin-right:240px;padding:2rem}
.card{background:white;padding:1.5rem;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);margin-bottom:1rem}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}
.stat{background:#eff6ff;padding:1rem;border-radius:8px;text-align:center}
</style></head><body>
<div class="sidebar"><h3>🎓 TOFAS</h3>
<a href="/student/dashboard">الرئيسية</a>
<a href="/student/exams">الامتحانات</a>
<a href="/student/results">النتائج</a>
<a href="#" onclick="logout()">تسجيل الخروج</a></div>
<div class="main"><div class="card"><h2>مرحباً ${student.fullName}</h2><p>${student.username}</p></div>
<div class="stats" id="stats"><div class="stat"><h4>الامتحانات</h4><p id="examCount">...</p></div></div></div>
<script>
const token=localStorage.getItem('token');
async function load(){const res=await fetch('/api/exams/student',{headers:{'Authorization':'Bearer '+token}});const exams=await res.json();document.getElementById('examCount').textContent=exams.length;}
load();
function logout(){localStorage.clear();window.location.href='/student';}
</script></body></html>`;
}

function getStudentExamsPage() {
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>الامتحانات</title>
<style>body{font-family:sans-serif;background:#f8fafc;padding:2rem}
.exam-card{background:white;padding:1rem;border-radius:12px;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center}
button{background:#2563eb;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer}
.modal{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);align-items:center;justify-content:center}
.modal-content{background:white;padding:2rem;border-radius:12px;text-align:center}
</style></head><body>
<h2>الامتحانات المتاحة</h2><div id="list"></div>
<div class="modal" id="modal"><div class="modal-content"><h3>كلمة المرور</h3><input id="pwd" type="password"><br><br>
<button onclick="startExam()">دخول</button><button onclick="closeModal()" style="background:#94a3b8">إلغاء</button></div></div>
<script>
const token=localStorage.getItem('token');let currentExamId;
async function load(){
    const res=await fetch('/api/exams/student',{headers:{'Authorization':'Bearer '+token}});
    const exams=await res.json();
    document.getElementById('list').innerHTML=exams.map(e=>'<div class="exam-card"><span>'+e.title+' ('+e.duration+'د)</span><button onclick="openModal(\''+e._id+'\')">دخول</button></div>').join('');
}
function openModal(id){currentExamId=id;document.getElementById('modal').style.display='flex';}
function closeModal(){document.getElementById('modal').style.display='none';}
async function startExam(){
    const pwd=document.getElementById('pwd').value;
    const res=await fetch('/api/exams/'+currentExamId+'/verify-password',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({password:pwd})});
    const data=await res.json();
    if(data.success) window.location.href='/student/exam-room?examId='+currentExamId;
    else alert('كلمة مرور خاطئة');
}
load();
</script></body></html>`;
}

function getExamRoomPage() {
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>غرفة الامتحان</title>
<style>body{font-family:sans-serif;background:#f8fafc;padding:1rem}
.timer{text-align:center;font-size:2rem;color:#dc2626}
.question-box{background:white;padding:2rem;border-radius:12px;margin-top:1rem}
.options div{margin:0.5rem 0}
</style></head><body>
<h2 id="examTitle"></h2><div class="timer" id="timer">00:00</div>
<div class="question-box" id="questionBox"></div>
<button onclick="submitExam()">إنهاء الامتحان</button>
<script>
const token=localStorage.getItem('token');
const params=new URLSearchParams(window.location.search);
const examId=params.get('examId');
let examData,questions=[],current=0,timeLeft=0,interval;
async function init(){
    const res=await fetch('/api/exams/'+examId,{headers:{'Authorization':'Bearer '+token}});
    examData=await res.json();
    document.getElementById('examTitle').textContent=examData.title;
    timeLeft=examData.duration*60;
    const qRes=await fetch('/api/questions?level='+examData.level,{headers:{'Authorization':'Bearer '+token}});
    questions=await qRes.json();
    showQuestion();
    interval=setInterval(updateTimer,1000);
}
function updateTimer(){
    const min=Math.floor(timeLeft/60),sec=timeLeft%60;
    document.getElementById('timer').textContent=min+':'+(sec<10?'0':'')+sec;
    if(timeLeft<=0){clearInterval(interval);submitExam();}
    timeLeft--;
}
function showQuestion(){
    const q=questions[current];
    if(!q) return;
    let html='<h3>'+q.questionText+'</h3>';
    if(q.options) q.options.forEach((o,i)=>html+='<div><input type="radio" name="answer" value="'+i+'">'+o.text+'</div>');
    document.getElementById('questionBox').innerHTML=html;
}
function submitExam(){alert('تم التسليم');window.location.href='/student/dashboard';}
init();
</script></body></html>`;
}

// ---------- ROUTES FOR HTML PAGES ----------
app.get('/student', (req, res) => res.send(getStudentLoginPage()));
app.get('/student/login', (req, res) => res.send(getStudentLoginPage()));
app.get('/student/dashboard', (req, res) => {
    // Verify token manually (simple)
    const token = req.query.token || (req.headers.authorization||'').split(' ')[1];
    if (!token) return res.redirect('/student');
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'student') return res.redirect('/student');
        res.send(getStudentDashboard({ fullName: 'طالب', username: '000000000' })); // simplified
    } catch(e) { res.redirect('/student'); }
});
app.get('/student/exams', (req, res) => res.send(getStudentExamsPage()));
app.get('/student/exam-room', (req, res) => res.send(getExamRoomPage()));

// Admin pages (basic)
app.get('/admin', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>دخول الإدارة</title>
<style>body{background:#0f172a;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif}
.card{background:#1e293b;padding:2rem;border-radius:16px;color:white;width:90%;max-width:400px;text-align:center}
input{width:100%;padding:12px;margin:8px 0;border-radius:8px;border:none;background:#334155;color:white}
button{width:100%;padding:12px;background:#2563eb;border:none;color:white;border-radius:8px;font-weight:bold;cursor:pointer}
.error{color:#f87171}</style></head><body><div class="card"><h2>🛡️ لوحة الإدارة</h2>
<input id="username" placeholder="اسم المستخدم"><input id="password" type="password" placeholder="كلمة المرور">
<button onclick="login()">دخول</button><p id="error" class="error"></p></div>
<script>
async function login(){
    const u=document.getElementById('username').value,p=document.getElementById('password').value;
    const res=await fetch('/api/auth/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const data=await res.json();
    if(res.ok){localStorage.setItem('adminToken',data.token);window.location.href='/admin/dashboard';}
    else document.getElementById('error').textContent=data.message;
}
</script></body></html>`);
});

app.get('/admin/dashboard', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>لوحة الإدارة</title>
<style>body{font-family:sans-serif;margin:0;background:#f8fafc}
.sidebar{width:240px;background:#1e293b;color:white;height:100vh;position:fixed;right:0;padding:1.5rem}
.sidebar a{color:#cbd5e1;text-decoration:none;display:block;padding:0.7rem;border-radius:8px}
.main{margin-right:240px;padding:2rem}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}
.stat{background:white;padding:1.5rem;border-radius:12px;text-align:center}
</style></head><body>
<div class="sidebar"><h3>TOFAS Admin</h3><a href="/admin/dashboard">الرئيسية</a><a href="#" onclick="logout()">خروج</a></div>
<div class="main"><h2>لوحة التحكم</h2><div class="stats"><div class="stat"><h4>الطلاب</h4><p id="students">-</p></div></div></div>
<script>
const token=localStorage.getItem('adminToken');
if(!token) window.location.href='/admin';
async function load(){const res=await fetch('/api/students',{headers:{'Authorization':'Bearer '+token}});const data=await res.json();document.getElementById('students').textContent=Array.isArray(data)?data.length:'...';}
load();
function logout(){localStorage.clear();window.location.href='/admin';}
</script></body></html>`);
});

// ---------- START SERVER ----------
mongoose.connect(MONGODB_URI).then(() => {
    console.log('MongoDB connected');
    server.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));
    // Create default admin if not exists
    Admin.findOne({ username: 'admin' }).then(admin => {
        if (!admin) {
            Admin.create({ username: 'admin', password: 'admin123', role: 'superadmin' });
            console.log('Default admin created: admin / admin123');
        }
    });
}).catch(err => console.error(err));