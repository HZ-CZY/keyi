const path=require('path');
const Database=require('better-sqlite3');
const db=new Database(path.join(__dirname,'..','data','keyi.db'));
const KEY='sk-NANDNW6rqsZb9rHUMB6jF6iVmLOESmaZqpmRyVnZZyIVeqwY';
const URL='https://api.agnes-ai.cn/v1/chat/completions';
const rows=db.prepare("select distinct fields from notes where fields like '%**间**%' and fields like '%==%'").all();
const senses=[];
for(const {fields} of rows){
  const arr=JSON.parse(fields);
  const m1=/\*\*(.+?)\*\*/.exec(arr[0]||''),m2=/==(.+?)==/.exec(arr[1]||'');
  if(!m1||!m2) continue;
  const def=m2[1].replace(/<br\s*\/?>/gi,'；').replace(/\*\*/g,'').trim();
  if(senses.some(s=>s.def===def)) continue;
  senses.push({sent:(arr[0]||'').replace(/<[^>]+>/g,'').replace(/\*\*/g,'').trim(),def,trans:(arr[2]||'').replace(/<[^>]+>/g,'').replace(/\*\*/g,'').trim()});
}
const list=senses.map((s,i)=>`${i+1}. 义项「${s.def}」　例句：${s.sent}（${s.trans}）`).join('\n');
const SYS='你是有二十年经验的高中语文老师，专攻文言实词。学生已背过课文例句，卡在「同一个字几个意思怎么分」。请写一段辨析。要求：1.先一句话点出引申脉络——义项怎么从本义长出来，让学生理解而非死记。2.再指出最容易混的两个义项，为什么混，怎么区分。3.给一个不超过20字的记忆钩子。4.像老师讲话，不要「首先/其次/综上」，不要罗列1234。5.只讲给出的义项，不补充课本外的新义项。6.全文180字内。只输出JSON，不要markdown：{"analysis":"...","confusion":"...","tip":"..."}';
const body={model:'agnes-2.5-flash',messages:[{role:'system',content:SYS},{role:'user',content:`字：间\n\n它在课文里出现过的义项：\n${list}\n\n请写辨析。`}],temperature:0.4};
(async()=>{
  const t=Date.now();
  const r=await fetch(URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${KEY}`},body:JSON.stringify(body)});
  const j=await r.json();
  console.log('耗时',((Date.now()-t)/1000).toFixed(1)+'s','HTTP',r.status);
  if(!r.ok){console.log(JSON.stringify(j).slice(0,250));return;}
  const txt=j.choices[0].message.content;
  console.log('原始:\n'+txt);
  try{const p=JSON.parse(txt.replace(/^```json\s*|\s*```$/g,''));
    console.log('\n【脉络】'+p.analysis);console.log('【易混】'+p.confusion);console.log('【钩子】'+p.tip);
  }catch(e){console.log('解析失败:',e.message);}
})();
