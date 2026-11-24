// SWEET ARCHIVE · 데이터 수집 스크립트
// GitHub Actions에서 실행되며, 인증키는 GitHub Secret(SERVICE_KEY)에서만 읽습니다.
import fs from 'node:fs';

const KEY = process.env.SERVICE_KEY;
if (!KEY) { console.error('SERVICE_KEY(Secret)가 설정되지 않았습니다.'); process.exit(1); }

const API = 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03';
const KEYWORDS = ['케이크', '쿠키', '마카롱', '도넛', '아이스크림', '푸딩', '스콘', '타르트', '와플', '크로와상'];
const CLASSES = [['rep', '품목대표'], ['prod', '상용제품']];
const ROWS = 100, MAX_PAGES = 3;

const num = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s.toUpperCase() === 'N/A') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(params) {
  for (let t = 1; t <= 3; t++) {
    try {
      const u = new URL(API);
      u.search = new URLSearchParams({ serviceKey: KEY, type: 'json', numOfRows: ROWS, ...params });
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      const text = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status);
      let d;
      try { d = JSON.parse(text); } catch { throw new Error('JSON이 아닌 응답 (인증키·서비스 활용신청 확인): ' + text.slice(0, 80)); }
      const code = String(d.header?.resultCode ?? '00');
      if (!['00', '0', '000'].includes(code)) throw new Error('API 오류 ' + code + ' ' + (d.header?.resultMsg || ''));
      let list = d.body?.items ?? [];
      if (!Array.isArray(list)) list = list.item ?? [];
      if (!Array.isArray(list)) list = [list];
      return { total: Number(d.body?.totalCount) || 0, list: list.map((x) => x?.item ?? x) };
    } catch (e) {
      console.error(`재시도 ${t}/3:`, e.message);
      if (t === 3) throw e;
      await sleep(2000 * t);
    }
  }
}

const map = new Map();
for (const k of KEYWORDS) {
  for (const [cls, clsName] of CLASSES) {
    let got = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { total, list } = await get({ pageNo: page, FOOD_NM_KR: k, DB_CLASS_NM: clsName });
      for (const r of list) {
        if (!r?.FOOD_NM_KR) continue;
        const id = r.FOOD_CD || r.FOOD_NM_KR;
        if (map.has(id)) continue;
        map.set(id, {
          id, k, cls,
          name: r.FOOD_NM_KR,
          maker: r.MAKER_NM || '',
          cat: r.FOOD_CAT1_NM || '',
          basis: r.SERVING_SIZE || '',
          ref: r.NUTRI_AMOUNT_SERVING || '',
          weight: r.Z10500 || '',
          kcal: num(r.AMT_NUM1), protein: num(r.AMT_NUM3), fat: num(r.AMT_NUM4),
          carb: num(r.AMT_NUM6), sugar: num(r.AMT_NUM7),
        });
      }
      got += list.length;
      await sleep(300);
      if (got >= total || list.length < ROWS) break;
    }
    console.log(`${k} / ${clsName}: ${got}건 확인`);
  }
}

if (map.size === 0) { console.error('받은 데이터가 0건이라 기존 파일을 유지합니다.'); process.exit(1); }
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/desserts.json', JSON.stringify({ updatedAt: new Date().toISOString(), source: '식품의약품안전처_식품영양성분DB정보', count: map.size, items: [...map.values()] }));
console.log('저장 완료:', map.size, '건');
