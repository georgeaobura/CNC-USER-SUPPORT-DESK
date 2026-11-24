require("dotenv").config();
const Database=require("better-sqlite3"),bcrypt=require("bcryptjs"),readline=require("readline");
const db=new Database("./data/ust.sqlite");
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=q=>new Promise(r=>rl.question(q,r));
(async()=>{try{
 const username=(await ask("Admin username: ")).trim();
 const full=(await ask("Admin full name: ")).trim();
 const password=await ask("Password (minimum 12 characters): ");
 if(!username||!full||password.length<12)throw new Error("Please provide all values and a password of at least 12 characters.");
 const hash=bcrypt.hashSync(password,12);
 db.prepare("INSERT INTO users(username,password_hash,role,full_name) VALUES(?,?,?,?)").run(username,hash,"admin",full);
 console.log("Administrator created.");}catch(e){console.error(e.message);}finally{rl.close();db.close();}})();
