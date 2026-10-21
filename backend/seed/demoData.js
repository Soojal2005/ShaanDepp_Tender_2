/**
 * Sample tenders and award results for LOCAL DEVELOPMENT ONLY (npm run seed:demo,
 * or SEED_DEMO=on). They are stored under the "excel" provider so they are never
 * mixed up with live Tenderbook data, and they are never created in production.
 * The generator is deterministic, so every developer sees the same sample.
 */

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;

const PLACES = {
  'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Sagar', 'Rewa'],
  Maharashtra: ['Pune', 'Nagpur', 'Nashik', 'Jalgaon'],
  Gujarat: ['Vadodara', 'Surat', 'Ahmedabad'],
  Rajasthan: ['Jaipur', 'Jodhpur', 'Bharatpur'],
  'Uttar Pradesh': ['Lucknow', 'Ghaziabad', 'Kanpur'],
  'Tamil Nadu': ['Chennai', 'Coimbatore'],
  Chhattisgarh: ['Raipur', 'Bilaspur'],
};

// [title, category, type, department, [min, max] rupees, boq items]
const TEMPLATES = [
  ['Construction of 100-bed district hospital building', 'Construction', 'Works', 'Public Works Department', [180e6, 520e6], ['RCC M30', 'Steel Fe500D', 'Electrical wiring', 'Medical gas pipeline']],
  ['Widening and strengthening of rural road under PMGSY', 'Construction', 'Works', 'Rural Development Department', [8e6, 60e6], ['Bitumen VG-30', 'Granular sub-base', 'Cross-drainage works']],
  ['Four laning of national highway section including service roads', 'Construction', 'Works', 'National Highways Authority of India (NHAI)', [600e6, 2500e6], ['Bituminous concrete', 'Embankment', 'Retaining wall']],
  ['Construction of RCC bridge over river with approaches', 'Construction', 'Works', 'Public Works Department', [40e6, 220e6], ['Pile foundation', 'PSC girders', 'Wearing coat']],
  ['Laying of water supply pipeline and overhead tank for rural habitations', 'Water Supply', 'Works', 'Public Health Engineering Department', [20e6, 180e6], ['DI pipe K9', 'Valves and fittings', 'Overhead tank 300 KL']],
  ['Supply and installation of ultrasonic water meters with AMR', 'Goods', 'Goods', 'Public Health Engineering Department', [6e6, 90e6], ['Ultrasonic meter DN15', 'Ultrasonic meter DN25', 'AMR gateway']],
  ['Supply of 100 kVA distribution transformers', 'Electrical Industry', 'Goods', 'State Electricity Distribution Company', [10e6, 70e6], ['Transformer 100 kVA', 'Dry type bushing']],
  ['Procurement of LED street lights with smart controllers', 'Electrical Industry', 'Goods', 'Smart City Development Corporation', [5e6, 40e6], ['LED luminaire 90W', 'Control unit']],
  ['Supply of laptops, desktops and printers for government offices', 'It And Telecommunications', 'Goods', 'School Education Department', [2e6, 30e6], ['Laptop i5', 'Laser printer']],
  ['Hiring of manpower for housekeeping and security services', 'Services', 'Services', 'Municipal Corporation', [3e6, 25e6], null],
  ['Annual maintenance contract for CCTV and surveillance systems', 'Services', 'Services', 'Smart City Development Corporation', [1e6, 12e6], null],
  ['Consultancy for preparation of detailed project report', 'Consultancy', 'Services', 'Urban Development Department', [1.5e6, 15e6], null],
  ['Setting up grid-connected rooftop solar PV projects under RESCO mode', 'Solar Power Plants', 'Works', 'Solar Energy Corporation Of India', [25e6, 400e6], ['Solar module 540Wp', 'Inverter', 'Mounting structure']],
  ['Supply of medical consumables and diagnostic equipment', 'Medical Related Equipment And Supplies', 'Goods', 'Health and Family Welfare Department', [4e6, 60e6], ['Syringe 5ml', 'Ultrasound machine']],
  ['Renovation of government school buildings and toilets', 'Construction', 'Works', 'School Education Department', [3e6, 35e6], ['Brick masonry', 'Plaster', 'Sanitary fixtures']],
  ['Construction of community toilets and solid waste facilities', 'Construction', 'Works', 'Municipal Corporation', [2e6, 20e6], ['RCC footing', 'Sanitary fixtures']],
  ['Overhauling of boiler and turbine auxiliaries', 'Power Generation And Transmission', 'Works', 'NTPC Limited', [30e6, 220e6], ['Boiler tubes', 'Turbine bearing']],
  ['Track maintenance and ballast supply', 'Construction', 'Works', 'South Central Railway', [12e6, 150e6], ['Ballast 50mm', 'Rail fastenings']],
  ['E-auction of scrap and unserviceable materials', 'Auction', 'Goods', 'Municipal Corporation', [0.5e6, 6e6], null],
  ['Hiring of vehicles for field survey and inspection', 'Services', 'Services', 'Public Works Department', [0.8e6, 5e6], null],
  ['Construction of check dam and canal lining works', 'Construction', 'Works', 'Rural Development Department', [10e6, 90e6], ['Stone masonry', 'Concrete lining']],
  ['Supply of ductile iron pipes and fittings', 'Goods', 'Goods', 'Public Health Engineering Department', [15e6, 120e6], ['DI pipe K7', 'Gate valve']],
];

const BIDDERS = ['Apex Infra Projects', 'Gupta Constructions Ltd', 'Narmada Builders', 'Vindhya Engineering Works', 'Shree Sai Contractors', 'Kaveri Infratech',
  'Mahakal Electricals', 'Bharat Water Solutions', 'Sunrise Power Systems', 'Rajdhani Constructions', 'Jai Hind Enterprises', 'Tapti Civil Works'];

const pick = (rand, list) => list[Math.floor(rand() * list.length)];

export function demoTenders(now = Date.now()) {
  const rand = mulberry32(2026);
  const out = [];
  for (let i = 0; i < 64; i++) {
    const [title, category, type, department, [lo, hi], boq] = TEMPLATES[i % TEMPLATES.length];
    const state = pick(rand, Object.keys(PLACES));
    const city = pick(rand, PLACES[state]);
    const published = Math.floor(rand() * 170); // days ago, spread across ~6 months
    const closed = published > 25 && rand() < 0.55;
    const dueIn = closed ? -Math.ceil(rand() * 40) : Math.max(1, Math.ceil(rand() * 40 - Math.min(published, 10)));
    const hasValue = rand() > 0.15;
    const value = hasValue ? Math.round((lo + rand() * (hi - lo)) / 1000) * 1000 : null;
    const hasEmd = value !== null && rand() > 0.1;
    out.push({
      tender_id: `DEMO-${String(i + 1).padStart(4, '0')}`,
      tender_no: `${department.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '')}/${city.slice(0, 3).toUpperCase()}/2026/${100 + i}`,
      tender_summary: i < TEMPLATES.length ? `${title}` : `${title} - ${city} package ${i}`,
      work_desc: `${title} at ${city}, ${state}. Includes all materials, labour, testing and handing over as per tender conditions.`,
      authority: department,
      category,
      state,
      city,
      ownership: 'Government Departments',
      procurement_type: type,
      tender_value: value,
      earnest_amount: hasEmd ? Math.round(value * 0.02) : null,
      doc_cost: rand() > 0.5 ? 0 : [500, 1000, 2000, 5000][Math.floor(rand() * 4)],
      pub_date: now - published * DAY,
      due_date: now + dueIn * DAY,
      open_date: now + (dueIn + 1) * DAY,
      tender_status: closed ? 'CLOSED' : 'OPEN',
      boq_details: boq,
      s3_document_path: [{ file_name: 'Notice_Inviting_Tender.pdf', download_id: `DOC-${i}-1` }, { file_name: 'Bid_Document.pdf', download_id: `DOC-${i}-2` }],
    });
  }
  return out;
}

export function demoResults(now = Date.now()) {
  const rand = mulberry32(99);
  const out = [];
  for (let i = 0; i < 18; i++) {
    const [title, category, , department, [lo, hi]] = TEMPLATES[(i * 3) % TEMPLATES.length];
    const state = pick(rand, Object.keys(PLACES));
    const estimate = Math.round((lo + rand() * (hi - lo)) / 1000) * 1000;
    const n = 3 + Math.floor(rand() * 5);
    const ranked = [...BIDDERS].sort(() => rand() - 0.5).slice(0, n);
    const publishRate = rand() > 0.2; // some sources publish only the winner
    const base = estimate * (0.82 + rand() * 0.2);
    const bidders = ranked.map((name, idx) => ({
      bidder_name: name.toLowerCase(),
      rank: idx + 1,
      bid_amount: publishRate ? Math.round(base * (1 + idx * (0.01 + rand() * 0.03))) : idx === 0 ? 0 : 0,
      technical_bid_status: idx < n - 1 ? 1 : 0,
      aoc_status: idx === 0 ? 1 : 2,
    }));
    out.push({
      tender_result_id: `DEMO-RES-${String(i + 1).padStart(3, '0')}`,
      tender_no: `${department.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '')}/RES/2026/${50 + i}`,
      authority: department,
      state,
      city: pick(rand, PLACES[state]),
      category,
      work_desc: `${title}`,
      product_name: title.split(' ').slice(0, 3).join(' '),
      tender_value: estimate,
      contract_date: now - Math.ceil(rand() * 160) * DAY,
      contract_value: publishRate ? bidders[0].bid_amount : null,
      procurement_source_name: 'Demo data',
      bidder_list: bidders,
    });
  }
  return out;
}
