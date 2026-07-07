// build.js — รวมงานวิ่งจาก 2 แหล่ง ทำความสะอาดข้อมูล แล้วเขียน events.json
// แหล่ง 1: events_base.json (ฐานวิ่งไหนดี - snapshot)
// แหล่ง 2: thai.run GraphQL API (ดึงสดทุกครั้งที่รัน)
// รันโดย GitHub Action ทุกสัปดาห์ (ดู .github/workflows/update.yml)
//
// v2 (ก.ค. 2026): เพิ่มระบบทำความสะอาดข้อมูล
// - แยกประเภทไตร/ทวิกีฬา (tri) ออกจากถนน
// - "อัลตรา" ต้องมีระยะ 50 กม.ขึ้นไปจริง (แก้เคส Ultraman Hero Run ระยะ 1.5-6 กม.)
// - จังหวัดจากชื่องาน override ข้อมูล API ที่ผิด (แก้เคส Chiang Mai 22K ขึ้นกรุงเทพฯ)
// - งานต่างประเทศติดป้ายประเทศ / งานไม่รู้สถานที่ขึ้น "ไม่ระบุสถานที่"
// - ยุบงานซ้ำข้ามแหล่ง (thai.run vs วิ่งไหนดี) ด้วย token overlap + วันใกล้กัน
//   *ยุบเฉพาะข้ามแหล่ง — แหล่งเดียวกันถือว่าคนละงาน (เช่น ซีรีส์ WRB12 จัด 12 จังหวัดวันเดียวกัน)
// - ตัดช่องทางสมัครที่ไม่ใช่งานแข่งของนักวิ่งทั่วไป (foreigner channel, pacer registration)

const fs = require('fs');

const THAIRUN_URL = 'https://api.race.thai.run/graphql?query=%7BlistEvents%28limit%3A200%2Csort%3ASTARTDATE_DESC%29%7Bslug%20name%7Bth%7D%20startDate%20isRegOpen%20provinces%20races%7Bdistance%7D%7D%7D';

// แปลงจังหวัด (อังกฤษ -> ไทย) + สถานที่ต่างประเทศติดป้ายประเทศ
const PROV = {
  'Bangkok':'กรุงเทพมหานคร','Chon Buri':'ชลบุรี','Chiang Mai':'เชียงใหม่','Chiang Rai':'เชียงราย',
  'Lampang':'ลำปาง','Surat Thani':'สุราษฎร์ธานี','Phuket':'ภูเก็ต','Songkhla':'สงขลา',
  'Phetchaburi':'เพชรบุรี','Nakhon Nayok':'นครนายก','Chaiyaphum':'ชัยภูมิ','Ubon Ratchathani':'อุบลราชธานี',
  'Trat':'ตราด','Phatthalung':'พัทลุง','Saraburi':'สระบุรี','Nakhon Pathom':'นครปฐม',
  'Phra Nakhon Si Ayutthaya':'พระนครศรีอยุธยา','Nakhon Si Thammarat':'นครศรีธรรมราช','Phang-nga':'พังงา',
  'Rayong':'ระยอง','Prachuap Khiri Khan':'ประจวบคีรีขันธ์','Mae Hong Son':'แม่ฮ่องสอน',
  'Nakhon Ratchasima':'นครราชสีมา','Phayao':'พะเยา','Krabi':'กระบี่','Loei':'เลย','Tak':'ตาก',
  'Udon Thani':'อุดรธานี','Khon Kaen':'ขอนแก่น','Buri Ram':'บุรีรัมย์','Nakhon Phanom':'นครพนม',
  'Sukhothai':'สุโขทัย','Uttaradit':'อุตรดิตถ์','Nakhon Sawan':'นครสวรรค์','Lamphun':'ลำพูน',
  'Nonthaburi':'นนทบุรี','Pathum Thani':'ปทุมธานี','Samut Sakhon':'สมุทรสาคร','Samut Prakarn':'สมุทรปราการ',
  'Kanchanaburi':'กาญจนบุรี','Chumphon':'ชุมพร','Trang':'ตรัง','Bueng Kan':'บึงกาฬ','Phrae':'แพร่',
  'Mukdahan':'มุกดาหาร','Kalasin':'กาฬสินธุ์','Sakon Nakhon':'สกลนคร','Nong Khai':'หนองคาย',
  // ต่างประเทศ
  'Selangor':'Selangor มาเลเซีย','Pulau Pinang':'ปีนัง มาเลเซีย','Kuala Lumpur':'กัวลาลัมเปอร์ มาเลเซีย',
  'Putrajaya':'ปุตราจายา มาเลเซีย','Negeri Sembilan':'เนกรีเซมบีลัน มาเลเซีย','Bali':'บาหลี อินโดนีเซีย'
};
const FOREIGN_PROV = ['Selangor','Pulau Pinang','Kuala Lumpur','Putrajaya','Negeri Sembilan','Bali'];

// คีย์เวิร์ดในชื่องาน -> จังหวัด (ใช้ override เมื่อ API/ฐานให้จังหวัดผิดหรือว่าง)
const NAME_PROV = [
  ['chiang mai','เชียงใหม่'],['เชียงใหม่','เชียงใหม่'],['doi suthep','เชียงใหม่'],
  ['krabi','กระบี่'],['กระบี่','กระบี่'],
  ['hatyai','สงขลา'],['หาดใหญ่','สงขลา'],['songkhla','สงขลา'],
  ['ubon','อุบลราชธานี'],['อุบล','อุบลราชธานี'],
  ['นครพนม','นครพนม'],['nakhon phanom','นครพนม'],
  ['สุโขทัย','สุโขทัย'],['sukhothai','สุโขทัย'],
  ['ชัยภูมิ','ชัยภูมิ'],['chaiyaphum','ชัยภูมิ'],
  ['บึงกาฬ','บึงกาฬ'],['buengkan','บึงกาฬ'],
  ['phuket','ภูเก็ต'],['ภูเก็ต','ภูเก็ต'],
  ['koh chang','ตราด'],['เกาะช้าง','ตราด'],
  ['สมุย','สุราษฎร์ธานี'],['samui','สุราษฎร์ธานี']
];

// คีย์เวิร์ดงานต่างประเทศ (ทัวร์วิ่ง/งานเมืองนอก)
const FOREIGN_KW = /ทัวร์วิ่ง|kobe|niigata|fuji|luang prabang|หลวงพระบาง|pakse|ปากเซ|maybank|danang|tohoku|ตงอิ๋ง|ไทเป/i;

// ช่องทางสมัครที่ไม่ใช่งานแข่งปกติ — ไม่เอาขึ้นเว็บ
const SKIP_KW = /foreigner|pacer registration/i;

const TRI_KW = /triathlon|duathlon|ไตรกีฬา|ทวิกีฬา|swimfest|swimming/i;
const TRAIL_KW = /trail|เทรล|cross country|ครอสคันทรี|ครอส คันทรี/i;

function typeOf(n, dist){
  if (TRI_KW.test(n)) return 'tri';
  if (/virtual|วิ่งสะสม|vr /i.test(n)) return 'virtual';
  const maxD = (dist && dist.length) ? Math.max(...dist) : null;
  if (/ultra|อัลตร|100k/i.test(n)){
    // "อัลตรา" ต้องมีระยะจริง 50+ (หรือไม่รู้ระยะ) — กัน Ultraman Hero Run 1.5-6 กม.
    if (maxD === null || maxD >= 50) return 'ultra';
    return TRAIL_KW.test(n) ? 'trail' : 'road';
  }
  if (TRAIL_KW.test(n)) return 'trail';
  return 'road';
}

// เติม/แก้จังหวัดจากชื่องาน + จัดการงานต่างประเทศ + ป้ายไม่ระบุ
function fixPlace(e){
  const nl = (e.n||'').toLowerCase();
  for (const [kw, prov] of NAME_PROV){
    if (nl.includes(kw)){
      if (!(e.place||'').includes(prov)) e.place = prov;
      break;
    }
  }
  if (FOREIGN_KW.test(nl)){
    if (!e.place || e.place==='ต่างประเทศ/ทั่วไทย') e.place = 'ต่างประเทศ';
  }
  if (!e.place || e.place==='ต่างประเทศ/ทั่วไทย'){
    e.place = (e.type==='virtual') ? 'Virtual' : 'ไม่ระบุสถานที่';
  }
  return e;
}

// คีย์สำหรับยุบงานซ้ำแบบชื่อเกือบเหมือน: ตัดวงเล็บ ตัดปี ตัดอักขระพิเศษ
function normKey(n){
  return (n||'')
    .replace(/\([^)]*\)/g,'')
    .replace(/25[0-9]{2}|20[0-9]{2}/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]/g,'')
    .slice(0,40);
}

// token สำหรับเทียบชื่อข้ามแหล่ง (ตัดคำทั่วไป/ปี/เลขครั้ง)
function tokens(n){
  let s = (n||'').toLowerCase().normalize('NFKC')
    .replace(/["'“”‘’!@#:;,\.\(\)\[\]\/\\\-–—&+•]/g,' ')
    .replace(/\b(20\d\d|25\d\d)\b/g,' ')
    .replace(/(ครั้งที่|ep|season|chapter|#)\s*\d+/g,' ')
    .replace(/\b(the|by|presented|presents|run|running|marathon|marathons|mini|minimarathon|half|walk|first|1st|2nd|3rd|4th|5th)\b/g,' ')
    .replace(/เดิน|วิ่ง|งาน/g,' ');
  // ตัด token ตัวเลขล้วน (เลขครั้ง/รุ่น) — วันจัดใช้เทียบอยู่แล้ว
  return new Set(s.split(/\s+/).filter(t=>t.length>=2 && !/^\d+$/.test(t)));
}
function jaccard(a,b){
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function placeCompatible(a,b){
  const pa=a.place||'', pb=b.place||'';
  if (!pa || !pb || pa.includes('ไม่ระบุ') || pb.includes('ไม่ระบุ')) return true;
  if (pa.includes(pb) || pb.includes(pa)) return true;
  const ta=new Set(pa.split(/[\s\/]+/).filter(Boolean));
  for (const t of pb.split(/[\s\/]+/)) if (ta.has(t)) return true;
  return false;
}
function dateVal(e){ return new Date(e.y, e.mo, e.d).getTime(); }
const DAY = 86400000;

// ยุบงานซ้ำข้ามแหล่ง: ชื่อคล้าย (jaccard>=0.6) + วันห่างไม่เกิน 3 วัน + สถานที่เข้ากันได้
// เก็บตัวที่มีลิงก์ (thai.run) แล้วดึง place/multi ที่ดีกว่าจากอีกตัวมาเติม
function dedupeCross(list){
  const final = [];
  for (const e of list){
    e._tok = e._tok || tokens(e.n);
    let dup = null;
    for (const f of final){
      if ((e.src||'') === (f.src||'')) continue;           // ข้ามแหล่งเท่านั้น
      if (Math.abs(dateVal(e)-dateVal(f)) > 3*DAY) continue;
      if (!placeCompatible(e,f)) continue;
      if (jaccard(e._tok, f._tok) >= 0.6){ dup = f; break; }
    }
    if (dup){
      const winner = dup.link ? dup : e;
      const loser  = dup.link ? e : dup;
      if ((!winner.place || winner.place==='ไม่ระบุสถานที่') && loser.place) winner.place = loser.place;
      if (loser.multi) winner.multi = true;
      // ถ้าตัวที่ชนะคือ e (เข้ามาใหม่) ให้สลับใน final
      if (winner === e){ final.splice(final.indexOf(dup),1); final.push(e); }
      console.log('  dedupe:', loser.n, '==', winner.n);
    } else {
      final.push(e);
    }
  }
  final.forEach(e=>delete e._tok);
  return final;
}

// แปลง ISO (UTC) -> วันเวลาไทย (UTC+7)
function thDate(iso){
  const d = new Date(new Date(iso).getTime() + 7*3600*1000);
  return { d:d.getUTCDate(), mo:d.getUTCMonth(), y:d.getUTCFullYear() };
}

async function fetchThaiRun(){
  try{
    const res = await fetch(THAIRUN_URL, { headers:{'User-Agent':'idorun-bot'} });
    const json = await res.json();
    const list = (json.data && json.data.listEvents) || [];
    return list
      .filter(e => !SKIP_KW.test(((e.name&&e.name.th)||'') + ' ' + e.slug))
      .map(e=>{
        const name = ((e.name && e.name.th) || e.slug).trim();
        const dt = thDate(e.startDate);
        const dist = [...new Set((e.races||[]).map(r=>r.distance).filter(n=>typeof n==='number' && n>0))].sort((a,b)=>a-b);
        const place = (e.provinces||[]).map(p=>PROV[p]||p).join(' / ');
        return fixPlace({
          n: name,
          place: place,
          type: typeOf(name, dist),
          d: dt.d, mo: dt.mo, y: dt.y,
          multi: false,
          reg: !!e.isRegOpen,
          link: 'https://race.thai.run/event/' + e.slug,
          src: 'thai.run',
          ...(dist.length ? { dist } : {})
        });
      });
  }catch(err){
    console.error('thai.run fetch failed:', err.message);
    return []; // ถ้าดึงไม่ได้ ใช้ฐานอย่างเดียว
  }
}

// งานในฐาน snapshot (วิ่งไหนดี) ที่เป็นตัวซ้ำกับ thai.run แต่ชื่อต่างจนจับอัตโนมัติไม่ได้
// (ฐานเป็น snapshot คงที่ ลิสต์นี้จึงไม่ต้องอัปเดตบ่อย — เพิ่มเมื่ออัปเดต events_base.json เท่านั้น)
const MANUAL_DROP = new Set([
  '12 AUG Half Marathon 2026 (ครั้งที่ 31)',
  'SciKU Run Together 2026 ครั้งที่ 3',
  'SIRA RUN 2026',
  'Run To School 2026',
  'U-TAPAO RUN 2026',
  'Bangkok Post International Mini Marathon 2026',
  'วิ่งติดมันส์ รันพระนคร ครั้งที่ 2/2026',
  'ACVRUN 2026: the Ultimate Line',
  '(เลื่อน)Bangkok Marathon 2026 ครั้งที่37'
]);
// ข้อมูลเสริมจากฐานที่อยากเก็บไว้แม้ตัวงานถูกยุบเข้ากับ thai.run
const ENRICH = {
  '12 สิงหา ฮาล์ฟมาราธอน กรุงเทพฯ 2026 ครั้งที่ 31': { place:'ศูนย์สิริกิติ์ กรุงเทพมหานคร' },
  '“วิ่งด้วยกัน...Run กับหมอศิริราช - รามาธิบดี ประจำปี 2569” (SIRA RUN 2026)': { place:'ร.พ.รามาธิบดี กรุงเทพมหานคร' },
  'U-TAPAO RUN 2026 The Runway Adventure': { place:'ระยอง' },
  'Songkhla Marathon 2026': { multi:true }
};

async function main(){
  const base = JSON.parse(fs.readFileSync('events_base.json','utf8'))
    .filter(e => !SKIP_KW.test(e.n||'') && !MANUAL_DROP.has(e.n||''))
    .map(e => fixPlace({ ...e, type: typeOf(e.n, e.dist) }));
  const live = (await fetchThaiRun()).map(e => ENRICH[e.n] ? Object.assign(e, ENRICH[e.n]) : e);
  console.log('base:', base.length, '| thai.run:', live.length);

  // 1) ยุบชื่อเกือบเหมือนภายในผลรวม (เช่น BANGSAEN42 หลายช่องทางสมัคร)
  const seen = new Set();
  const merged = [];
  for (const e of live){
    const k = normKey(e.n);
    if (seen.has(k)) continue;
    seen.add(k); merged.push(e);
  }
  for (const e of base){
    const k = normKey(e.n);
    if (seen.has(k)) continue;
    seen.add(k); merged.push(e);
  }

  // 2) ยุบงานซ้ำข้ามแหล่งแบบชื่อไม่เหมือนกันเป๊ะ
  const deduped = dedupeCross(merged);
  console.log('merged:', merged.length, '-> deduped:', deduped.length);

  // 3) เก็บเฉพาะงานที่ยังไม่จัด (>= เมื่อวาน) แล้วเรียงวันใกล้สุดก่อน
  const today = new Date();
  const cut = new Date(today.getFullYear(), today.getMonth(), today.getDate()-1);
  const upcoming = deduped
    .filter(e => new Date(e.y, e.mo, e.d) >= cut)
    .sort((a,b)=> (a.y-b.y)||(a.mo-b.mo)||(a.d-b.d));

  const out = {
    generatedAt: new Date().toISOString(),
    count: upcoming.length,
    fromThaiRun: live.length,
    events: upcoming
  };
  fs.writeFileSync('events.json', JSON.stringify(out));
  console.log('events.json written:', upcoming.length, 'events');
}

if (require.main === module) main();
module.exports = { typeOf, fixPlace, normKey, tokens, jaccard, placeCompatible, dedupeCross };
