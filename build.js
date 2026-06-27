// build.js — รวมงานวิ่งจาก 2 แหล่ง แล้วเขียน events.json
// แหล่ง 1: events_base.json (ฐานวิ่งไหนดี - snapshot)
// แหล่ง 2: thai.run GraphQL API (ดึงสดทุกครั้งที่รัน)
// รันโดย GitHub Action ทุกสัปดาห์ (ดู .github/workflows/update.yml)

const fs = require('fs');

const THAIRUN_URL = 'https://api.race.thai.run/graphql?query=%7BlistEvents%28limit%3A200%2Csort%3ASTARTDATE_DESC%29%7Bslug%20name%7Bth%7D%20startDate%20isRegOpen%20provinces%7D%7D';

// แปลงจังหวัด (อังกฤษ -> ไทย) เท่าที่พบบ่อย
const PROV = {
  'Bangkok':'กรุงเทพมหานคร','Chon Buri':'ชลบุรี','Chiang Mai':'เชียงใหม่','Chiang Rai':'เชียงราย',
  'Lampang':'ลำปาง','Surat Thani':'สุราษฎร์ธานี','Phuket':'ภูเก็ต','Songkhla':'สงขลา',
  'Phetchaburi':'เพชรบุรี','Nakhon Nayok':'นครนายก','Chaiyaphum':'ชัยภูมิ','Ubon Ratchathani':'อุบลราชธานี',
  'Trat':'ตราด','Phatthalung':'พัทลุง','Saraburi':'สระบุรี','Nakhon Pathom':'นครปฐม',
  'Phra Nakhon Si Ayutthaya':'พระนครศรีอยุธยา','Nakhon Si Thammarat':'นครศรีธรรมราช','Phang-nga':'พังงา',
  'Rayong':'ระยอง','Prachuap Khiri Khan':'ประจวบคีรีขันธ์','Mae Hong Son':'แม่ฮ่องสอน',
  'Nakhon Ratchasima':'นครราชสีมา','Phayao':'พะเยา','Krabi':'กระบี่','Loei':'เลย','Tak':'ตาก',
  'Udon Thani':'อุดรธานี','Khon Kaen':'ขอนแก่น','Buri Ram':'บุรีรัมย์','Nakhon Phanom':'นครพนม',
  'Sukhothai':'สุโขทัย','Uttaradit':'อุตรดิตถ์','Nakhon Sawan':'นครสวรรค์','Lamphun':'ลำพูน'
};

function typeOf(n){
  if (/ultra|อัลตร|x250|x 250|100k|100|250/i.test(n)) return 'ultra';
  if (/virtual|วิ่งสะสม|vr /i.test(n)) return 'virtual';
  if (/trail|เทรล|cross country|ครอสคันทรี|ครอส คันทรี/i.test(n)) return 'trail';
  return 'road';
}

// คีย์สำหรับยุบงานซ้ำ: ตัดวงเล็บ ตัดปี ตัดอักขระพิเศษ
function normKey(n){
  return (n||'')
    .replace(/\([^)]*\)/g,'')
    .replace(/25[0-9]{2}|20[0-9]{2}/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]/g,'')
    .slice(0,40);
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
    return list.map(e=>{
      const name = (e.name && e.name.th) || e.slug;
      const dt = thDate(e.startDate);
      const place = (e.provinces||[]).map(p=>PROV[p]||p).join(' ');
      return {
        n: name.trim(),
        place: place || 'ต่างประเทศ/ทั่วไทย',
        type: typeOf(name),
        d: dt.d, mo: dt.mo, y: dt.y,
        multi: false,
        reg: !!e.isRegOpen,
        link: 'https://race.thai.run/event/' + e.slug,
        src: 'thai.run'
      };
    });
  }catch(err){
    console.error('thai.run fetch failed:', err.message);
    return []; // ถ้าดึงไม่ได้ ใช้ฐานอย่างเดียว
  }
}

async function main(){
  const base = JSON.parse(fs.readFileSync('events_base.json','utf8'));
  const live = await fetchThaiRun();
  console.log('base:', base.length, '| thai.run:', live.length);

  // รวม: เอา thai.run ก่อน (มีลิงก์+สถานะ) แล้วเติมจากฐานที่ยังไม่ซ้ำ
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

  // เก็บเฉพาะงานที่ยังไม่จัด (>= เมื่อวาน) แล้วเรียงวันใกล้สุดก่อน
  const today = new Date();
  const cut = new Date(today.getFullYear(), today.getMonth(), today.getDate()-1);
  const upcoming = merged
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

main();
