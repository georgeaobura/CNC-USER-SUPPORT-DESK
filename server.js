require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "ust.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'officer',
 full_name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS districts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS churches (
 id INTEGER PRIMARY KEY AUTOINCREMENT, district_id INTEGER NOT NULL,
 name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(district_id) REFERENCES districts(id),
 UNIQUE(district_id,name)
);
CREATE TABLE IF NOT EXISTS tickets (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_no TEXT UNIQUE NOT NULL,
 system TEXT NOT NULL, year INTEGER NOT NULL, sequence INTEGER NOT NULL,
 full_name TEXT NOT NULL, district_id INTEGER NOT NULL, church_id INTEGER NOT NULL,
 support_type TEXT NOT NULL, description TEXT, phone TEXT NOT NULL, email TEXT,
 status TEXT NOT NULL DEFAULT 'Pending', priority TEXT NOT NULL DEFAULT 'Medium',
 assigned_to INTEGER, resolution TEXT, internal_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at TEXT, updated_by INTEGER,
 FOREIGN KEY(district_id) REFERENCES districts(id),
 FOREIGN KEY(church_id) REFERENCES churches(id),
 FOREIGN KEY(assigned_to) REFERENCES users(id),
 FOREIGN KEY(updated_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ticket_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL,
 actor TEXT NOT NULL, action TEXT NOT NULL, details TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(ticket_id) REFERENCES tickets(id)
);
CREATE TABLE IF NOT EXISTS sequences (
 system TEXT NOT NULL, year INTEGER NOT NULL, last_value INTEGER NOT NULL,
 PRIMARY KEY(system,year)
);
`);

const seed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "districts.json"), "utf8"));
const insertDistrict = db.prepare("INSERT OR IGNORE INTO districts(name) VALUES(?)");
const findDistrict = db.prepare("SELECT id FROM districts WHERE name=?");
const insertChurch = db.prepare("INSERT OR IGNORE INTO churches(district_id,name) VALUES(?,?)");
const seedTx = db.transaction(() => {
  for (const d of seed) {
    insertDistrict.run(d.name);
    const id = findDistrict.get(d.name).id;
    for (const c of d.churches) insertChurch.run(id, c);
  }
});
seedTx();

const adminCount = db.prepare("SELECT COUNT(*) n FROM users").get().n;
if (!adminCount && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
  db.prepare("INSERT INTO users(username,password_hash,role,full_name) VALUES(?,?,?,?)")
    .run(process.env.ADMIN_USERNAME, hash, "admin", "System Administrator");
}
if (!process.env.JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET is not configured. Set it in .env before deployment.");
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "150kb" }));
app.use(express.static(path.join(__dirname, "public")));
const loginLimiter = rateLimit({ windowMs: 15*60*1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const submitLimiter = rateLimit({ windowMs: 10*60*1000, limit: 20, standardHeaders: true, legacyHeaders: false });

function clean(v, max=500) { return String(v ?? "").trim().slice(0,max); }
function auth(req,res,next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i,"");
  try {
    if (!token) throw new Error("missing");
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare("SELECT id,username,role,full_name,active FROM users WHERE id=?").get(payload.id);
    if (!user || !user.active) throw new Error("inactive");
    req.user = user; next();
  } catch { return res.status(401).json({error:"Please sign in again."}); }
}
function adminOnly(req,res,next) {
  if (req.user.role !== "admin") return res.status(403).json({error:"Administrator access required."});
  next();
}
function event(ticketId, actor, action, details="") {
  db.prepare("INSERT INTO ticket_events(ticket_id,actor,action,details) VALUES(?,?,?,?)")
    .run(ticketId, actor, action, details);
}
function systemPrefix(system) {
  return ({ACMS:"ACMS","E-SADAKA":"ESADAKA","CNC DIGITAL ASSISTANT":"CNCDA"})[system];
}

app.get("/api/meta", (req,res) => {
 const districts = db.prepare(`SELECT d.id,d.name FROM districts d WHERE d.active=1 ORDER BY d.name`).all();
 const churches = db.prepare(`SELECT c.id,c.name,c.district_id FROM churches c JOIN districts d ON d.id=c.district_id WHERE c.active=1 AND d.active=1 ORDER BY c.name`).all();
 res.json({systems:["ACMS","E-SADAKA","CNC DIGITAL ASSISTANT"],
  supportTypes:["Password reset / Forgot password","New Account Creation","Account expired","New user Training","Refresher Training","Other challenges"],
  districts, churches});
});

app.post("/api/tickets", submitLimiter, (req,res) => {
 const b=req.body||{};
 const full_name=clean(b.full_name,120), system=clean(b.system,40), support_type=clean(b.support_type,80);
 const phone=clean(b.phone,40), email=clean(b.email,160), description=clean(b.description,2000);
 const district_id=Number(b.district_id), church_id=Number(b.church_id);
 if (!full_name || !phone || !district_id || !church_id || !systemPrefix(system) || !support_type)
   return res.status(400).json({error:"Please complete all required fields."});
 const district=db.prepare("SELECT id FROM districts WHERE id=? AND active=1").get(district_id);
 const church=db.prepare("SELECT id FROM churches WHERE id=? AND district_id=? AND active=1").get(church_id,district_id);
 if (!district || !church) return res.status(400).json({error:"Select an active church belonging to the selected district."});
 if (support_type==="Other challenges" && !description) return res.status(400).json({error:"Please describe the other challenge."});
 const year=new Date().getFullYear(), prefix=systemPrefix(system);
 const create=db.transaction(()=>{
   db.prepare("INSERT INTO sequences(system,year,last_value) VALUES(?,?,1) ON CONFLICT(system,year) DO UPDATE SET last_value=last_value+1").run(system,year);
   const seq=db.prepare("SELECT last_value FROM sequences WHERE system=? AND year=?").get(system,year).last_value;
   const ticket_no=`${prefix}-${year}-${String(seq).padStart(5,"0")}`;
   const info=db.prepare(`INSERT INTO tickets(ticket_no,system,year,sequence,full_name,district_id,church_id,support_type,description,phone,email)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(ticket_no,system,year,seq,full_name,district_id,church_id,support_type,description,phone,email);
   event(info.lastInsertRowid,"Requester","Ticket submitted",support_type);
   return ticket_no;
 });
 const ticket_no=create();
 res.status(201).json({ticket_no,message:"Your request has been submitted."});
});

app.get("/api/tickets/track", (req,res)=>{
 const no=clean(req.query.ticket_no,40), phone=clean(req.query.phone,40);
 if(!no||!phone) return res.status(400).json({error:"Enter your ticket number and the phone number used when submitting."});
 const t=db.prepare(`SELECT t.ticket_no,t.system,t.support_type,t.status,t.priority,t.created_at,t.updated_at,t.resolution,
 d.name district,c.name church FROM tickets t JOIN districts d ON d.id=t.district_id JOIN churches c ON c.id=t.church_id
 WHERE t.ticket_no=? AND t.phone=?`).get(no,phone);
 if(!t) return res.status(404).json({error:"No matching ticket was found. Check the ticket number and phone number."});
 res.json(t);
});

app.post("/api/admin/login",loginLimiter,(req,res)=>{
 const username=clean(req.body?.username,80), password=String(req.body?.password||"");
 const u=db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(username);
 if(!u || !bcrypt.compareSync(password,u.password_hash)) return res.status(401).json({error:"Incorrect username or password."});
 const token=jwt.sign({id:u.id},process.env.JWT_SECRET,{expiresIn:"8h"});
 res.json({token,user:{id:u.id,username:u.username,role:u.role,full_name:u.full_name}});
});
app.get("/api/admin/me",auth,(req,res)=>res.json({user:req.user}));
app.post("/api/admin/users",auth,adminOnly,(req,res)=>{
 const username=clean(req.body?.username,80), full_name=clean(req.body?.full_name,120);
 const password=String(req.body?.password||""), role=req.body?.role==="admin"?"admin":"officer";
 if(!username||!full_name||password.length<12) return res.status(400).json({error:"Provide username, full name and a password of at least 12 characters."});
 try {
  const info=db.prepare("INSERT INTO users(username,password_hash,role,full_name) VALUES(?,?,?,?)")
    .run(username,bcrypt.hashSync(password,12),role,full_name);
  res.status(201).json({id:info.lastInsertRowid,username,role,full_name});
 } catch { res.status(409).json({error:"That username is already in use."}); }
});
app.get("/api/admin/users",auth,adminOnly,(req,res)=>{
 res.json(db.prepare("SELECT id,username,role,full_name,active,created_at FROM users ORDER BY full_name").all());
});
app.patch("/api/admin/users/:id",auth,adminOnly,(req,res)=>{
 const active=req.body?.active?1:0;
 db.prepare("UPDATE users SET active=? WHERE id=?").run(active,Number(req.params.id));
 res.json({ok:true});
});

app.get("/api/admin/tickets",auth,(req,res)=>{
 const where=[],args=[];
 for(const [key,col] of Object.entries({system:"t.system",status:"t.status",priority:"t.priority"})){
  if(req.query[key]) {where.push(`${col}=?`);args.push(clean(req.query[key],80));}
 }
 if(req.query.district_id){where.push("t.district_id=?");args.push(Number(req.query.district_id));}
 if(req.query.q){const q=`%${clean(req.query.q,100)}%`;where.push("(t.ticket_no LIKE ? OR t.full_name LIKE ? OR t.phone LIKE ? OR c.name LIKE ?)");args.push(q,q,q,q);}
 const sql=`SELECT t.*,d.name district,c.name church,u.full_name assigned_name
 FROM tickets t JOIN districts d ON d.id=t.district_id JOIN churches c ON c.id=t.church_id
 LEFT JOIN users u ON u.id=t.assigned_to ${where.length?"WHERE "+where.join(" AND "):""}
 ORDER BY CASE t.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
 t.created_at DESC LIMIT 1000`;
 res.json(db.prepare(sql).all(...args));
});
app.get("/api/admin/tickets/:id/events",auth,(req,res)=>{
 res.json(db.prepare("SELECT * FROM ticket_events WHERE ticket_id=? ORDER BY created_at DESC").all(Number(req.params.id)));
});
app.patch("/api/admin/tickets/:id",auth,(req,res)=>{
 const id=Number(req.params.id), old=db.prepare("SELECT * FROM tickets WHERE id=?").get(id);
 if(!old) return res.status(404).json({error:"Ticket not found."});
 const status=clean(req.body?.status||old.status,30), priority=clean(req.body?.priority||old.priority,20);
 const allowedStatus=["Pending","In Progress","Resolved","Closed","Awaiting Requester"];
 const allowedPriority=["Low","Medium","High","Critical"];
 if(!allowedStatus.includes(status)||!allowedPriority.includes(priority)) return res.status(400).json({error:"Invalid status or priority."});
 const assigned=req.body?.assigned_to?Number(req.body.assigned_to):null;
 if(assigned && !db.prepare("SELECT id FROM users WHERE id=? AND active=1").get(assigned)) return res.status(400).json({error:"Invalid assignee."});
 const resolution=clean(req.body?.resolution,2000), notes=clean(req.body?.internal_notes,2000);
 db.prepare(`UPDATE tickets SET status=?,priority=?,assigned_to=?,resolution=?,internal_notes=?,
 updated_at=CURRENT_TIMESTAMP,resolved_at=CASE WHEN ?='Resolved' OR ?='Closed' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_by=? WHERE id=?`)
 .run(status,priority,assigned,resolution,notes,status,status,req.user.id,id);
 event(id,req.user.full_name,"Ticket updated",`Status: ${status}; Priority: ${priority}`);
 res.json({ok:true});
});
app.get("/api/admin/reports.csv",auth,(req,res)=>{
 const rows=db.prepare(`SELECT t.ticket_no,t.system,t.full_name,d.name district,c.name church,t.support_type,t.description,t.priority,t.status,
 u.full_name assigned_to,t.created_at,t.updated_at,t.resolution FROM tickets t
 JOIN districts d ON d.id=t.district_id JOIN churches c ON c.id=t.church_id LEFT JOIN users u ON u.id=t.assigned_to
 ORDER BY t.created_at DESC`).all();
 const cols=Object.keys(rows[0]||{ticket_no:"",system:"",full_name:"",district:"",church:"",support_type:"",description:"",priority:"",status:"",assigned_to:"",created_at:"",updated_at:"",resolution:""});
 const csv=[cols.join(","),...rows.map(r=>cols.map(k=>`"${String(r[k]??"").replace(/"/g,'""')}"`).join(","))].join("\r\n");
 res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",'attachment; filename="user-support-report.csv"');res.send("\uFEFF"+csv);
});

app.get("/api/admin/districts",auth,(req,res)=>{
 res.json(db.prepare(`SELECT d.*,COUNT(c.id) church_count FROM districts d LEFT JOIN churches c ON c.district_id=d.id GROUP BY d.id ORDER BY d.name`).all());
});
app.post("/api/admin/districts",auth,adminOnly,(req,res)=>{
 const name=clean(req.body?.name,100);if(!name)return res.status(400).json({error:"District name is required."});
 try{const r=db.prepare("INSERT INTO districts(name) VALUES(?)").run(name);res.status(201).json({id:r.lastInsertRowid,name,active:1});}
 catch{res.status(409).json({error:"A district with that name already exists."});}
});
app.patch("/api/admin/districts/:id",auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),name=req.body?.name===undefined?null:clean(req.body.name,100);
 const active=req.body?.active===undefined?null:(req.body.active?1:0);
 if(name!==null&&!name)return res.status(400).json({error:"District name cannot be blank."});
 try{if(name!==null)db.prepare("UPDATE districts SET name=? WHERE id=?").run(name,id);
 if(active!==null)db.prepare("UPDATE districts SET active=? WHERE id=?").run(active,id);
 res.json({ok:true});}catch{res.status(409).json({error:"Could not update district. Check for duplicate names."});}
});
app.get("/api/admin/churches",auth,(req,res)=>{
 res.json(db.prepare(`SELECT c.*,d.name district FROM churches c JOIN districts d ON d.id=c.district_id ORDER BY d.name,c.name`).all());
});
app.post("/api/admin/churches",auth,adminOnly,(req,res)=>{
 const name=clean(req.body?.name,120),district_id=Number(req.body?.district_id);
 if(!name||!db.prepare("SELECT id FROM districts WHERE id=?").get(district_id))return res.status(400).json({error:"Choose a district and enter a church name."});
 try{const r=db.prepare("INSERT INTO churches(name,district_id) VALUES(?,?)").run(name,district_id);res.status(201).json({id:r.lastInsertRowid});}
 catch{res.status(409).json({error:"That church already exists in this district."});}
});
app.patch("/api/admin/churches/:id",auth,adminOnly,(req,res)=>{
 const id=Number(req.params.id),name=req.body?.name===undefined?null:clean(req.body.name,120);
 const district_id=req.body?.district_id===undefined?null:Number(req.body.district_id);
 const active=req.body?.active===undefined?null:(req.body.active?1:0);
 try{
  if(name!==null)db.prepare("UPDATE churches SET name=? WHERE id=?").run(name,id);
  if(district_id!==null)db.prepare("UPDATE churches SET district_id=? WHERE id=?").run(district_id,id);
  if(active!==null)db.prepare("UPDATE churches SET active=? WHERE id=?").run(active,id);
  res.json({ok:true});
 }catch{res.status(409).json({error:"Could not update church. Check the name and district."});}
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`User Support Tool running at http://localhost:${PORT}`));
