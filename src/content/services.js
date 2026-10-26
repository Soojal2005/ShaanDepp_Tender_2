/**
 * The company website's service catalogue: eight groups taken from the signed
 * proposal (scope G). Every item gets its own page at /services/<group>/<item>.
 *
 * Each item is [English name, Hindi name]. Group and item copy is bilingual.
 * The Hindi wording is a DRAFT prepared for the client's review; the client's
 * brochure is the source of truth and replaces it once supplied.
 */
export const slugify = (text) =>
  String(text).toLowerCase().replace(/&/g, ' and ').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const same = (name) => [name, name];

export const GROUPS = [
  {
    slug: 'tender-information',
    icon: 'FileSearch',
    title: { en: 'Tender Information & Bidding Support', hi: 'टेंडर जानकारी और बोली सहायता' },
    summary: { en: 'Daily tender alerts, results and analysis, and hands-on help to prepare and submit winning bids.', hi: 'रोज़ाना टेंडर अलर्ट, परिणाम और विश्लेषण, और जीतने वाली बोली तैयार करने व जमा करने में सीधी मदद।' },
    how: {
      en: ['Your categories, states and departments are set once and matched to every new tender.', 'Our team checks eligibility and documents before you spend time on a bid.', 'Past results show how similar tenders were won, so your price is grounded in data.'],
      hi: ['आपकी श्रेणियाँ, राज्य और विभाग एक बार तय होते हैं और हर नए टेंडर से मिलाए जाते हैं।', 'बोली पर समय लगाने से पहले हमारी टीम पात्रता और दस्तावेज़ जाँच लेती है।', 'पिछले परिणाम दिखाते हैं कि समान टेंडर कैसे जीते गए, ताकि आपकी कीमत आँकड़ों पर आधारित हो।'],
    },
    items: [
      ['Email alerts', 'ईमेल अलर्ट'], ['Web access', 'वेब एक्सेस'], ['Tender results', 'टेंडर परिणाम'], ['Analytical reports', 'विश्लेषणात्मक रिपोर्ट'],
      ['Excel data', 'एक्सेल डेटा'], ['Upcoming projects', 'आगामी परियोजनाएँ'], ['Bidding assistance', 'बोली सहायता'], ['Eligibility check', 'पात्रता जाँच'],
      ['Bid strategy', 'बोली रणनीति'], ['Market analysis', 'बाज़ार विश्लेषण'], ['Document support', 'दस्तावेज़ सहायता'],
    ],
  },
  {
    slug: 'gem-portal',
    icon: 'ShoppingBag',
    title: { en: 'GeM Portal Specialist', hi: 'जेम पोर्टल विशेषज्ञ' },
    summary: { en: 'Everything a seller needs on the Government e-Marketplace, from registration to invoices.', hi: 'सरकारी ई-मार्केटप्लेस पर विक्रेता को जो कुछ चाहिए, पंजीकरण से लेकर इनवॉइस तक।' },
    how: {
      en: ['We set up and keep your GeM seller profile correct and active.', 'Catalogues, brands and OEM approvals are prepared to the portal\'s rules.', 'We support you through bids, reverse auctions, orders and billing.'],
      hi: ['हम आपकी जेम विक्रेता प्रोफ़ाइल सही और सक्रिय रखते हैं।', 'कैटलॉग, ब्रांड और OEM अनुमोदन पोर्टल के नियमों के अनुसार तैयार किए जाते हैं।', 'बोली, रिवर्स ऑक्शन, ऑर्डर और बिलिंग में हम आपके साथ रहते हैं।'],
    },
    items: [
      ['GeM ID & password creation', 'जेम आईडी और पासवर्ड बनाना'], ['Registration & caution money guidance', 'पंजीकरण और ज़मानत राशि मार्गदर्शन'],
      ['Catalogue management', 'कैटलॉग प्रबंधन'], ['OEM registration', 'OEM पंजीकरण'], ['Vendor assessment', 'विक्रेता मूल्यांकन'], ['Brand approval', 'ब्रांड अनुमोदन'],
      ['Reseller panel registration', 'रीसेलर पैनल पंजीकरण'], ['Direct purchase order assistance', 'डायरेक्ट परचेज़ ऑर्डर सहायता'], ['L1 / L2 process support', 'L1 / L2 प्रक्रिया सहायता'],
      ['Custom bid support', 'कस्टम बिड सहायता'], ['Tender submission assistance', 'टेंडर जमा करने में सहायता'], ['Bill & invoice creation', 'बिल और इनवॉइस बनाना'],
    ],
  },
  {
    slug: 'business-setup',
    icon: 'Building2',
    title: { en: 'Business Setup Solutions', hi: 'व्यवसाय स्थापना समाधान' },
    summary: { en: 'Choose the right structure and register it correctly, from a proprietorship to an NBFC.', hi: 'सही ढाँचा चुनें और उसे ठीक से पंजीकृत करें, प्रोप्राइटरशिप से NBFC तक।' },
    how: {
      en: ['We explain which structure suits your plans, liability and funding needs.', 'Name approval, incorporation and tax registrations are handled for you.', 'You receive a clear checklist of what to do after registration.'],
      hi: ['हम बताते हैं कि आपकी योजना, देनदारी और फंडिंग ज़रूरतों के लिए कौन सा ढाँचा उपयुक्त है।', 'नाम अनुमोदन, निगमन और कर पंजीकरण हम आपके लिए संभालते हैं।', 'पंजीकरण के बाद क्या करना है, उसकी स्पष्ट सूची आपको मिलती है।'],
    },
    items: [
      ['Private Limited company', 'प्राइवेट लिमिटेड कंपनी'], ['One Person Company', 'वन पर्सन कंपनी'], ['LLP', 'एलएलपी'], ['Proprietorship & partnership firm', 'प्रोप्राइटरशिप और पार्टनरशिप फर्म'],
      ['Public Limited company', 'पब्लिक लिमिटेड कंपनी'], ['Section 8 company (NGO)', 'धारा 8 कंपनी (NGO)'], ['Nidhi company', 'निधि कंपनी'], ['Trust & society', 'ट्रस्ट और सोसायटी'],
      ['Producer company', 'प्रोड्यूसर कंपनी'], ['Micro finance company', 'माइक्रो फाइनेंस कंपनी'], ['NBFC registration', 'NBFC पंजीकरण'],
    ],
  },
  {
    slug: 'compliance-roc',
    icon: 'ClipboardList',
    title: { en: 'Compliance & ROC Filings', hi: 'अनुपालन और ROC फाइलिंग' },
    summary: { en: 'Annual filings and compliance for companies, LLPs and other registered bodies, on time.', hi: 'कंपनियों, एलएलपी और अन्य पंजीकृत संस्थाओं के वार्षिक फाइलिंग और अनुपालन, समय पर।' },
    how: {
      en: ['A calendar of due dates for your entity so nothing is missed.', 'Accounts, returns and forms prepared and filed by our team.', 'Filing acknowledgements shared with you for your records.'],
      hi: ['आपकी संस्था की देय तिथियों का कैलेंडर, ताकि कुछ छूटे नहीं।', 'खाते, रिटर्न और फॉर्म हमारी टीम तैयार करके दाखिल करती है।', 'आपके रिकॉर्ड के लिए फाइलिंग की पावती आपको दी जाती है।'],
    },
    items: [
      ['Annual ROC filing for Pvt Ltd', 'प्राइवेट लिमिटेड की वार्षिक ROC फाइलिंग'], ['OPC compliance', 'OPC अनुपालन'], ['LLP annual compliance', 'एलएलपी वार्षिक अनुपालन'],
      ['Section 8 compliance', 'धारा 8 अनुपालन'], ['Nidhi ROC compliance', 'निधि ROC अनुपालन'], ['Producer company compliance', 'प्रोड्यूसर कंपनी अनुपालन'],
    ],
  },
  {
    slug: 'iso-certifications',
    icon: 'BadgeCheck',
    title: { en: 'ISO & Certifications', hi: 'ISO और प्रमाणपत्र' },
    summary: { en: 'Management-system and product certifications that tenders and buyers ask for.', hi: 'प्रबंधन-प्रणाली और उत्पाद प्रमाणपत्र जो टेंडर और खरीदार माँगते हैं।' },
    how: {
      en: ['We tell you which certificate a tender or buyer actually requires.', 'Documentation, internal checks and audit preparation are done with you.', 'Renewals and surveillance audits are tracked so the certificate stays valid.'],
      hi: ['हम बताते हैं कि किसी टेंडर या खरीदार को वास्तव में कौन सा प्रमाणपत्र चाहिए।', 'दस्तावेज़ीकरण, आंतरिक जाँच और ऑडिट की तैयारी आपके साथ मिलकर होती है।', 'नवीनीकरण और निगरानी ऑडिट पर नज़र रखी जाती है ताकि प्रमाणपत्र वैध रहे।'],
    },
    items: [
      same('ISO 9001'), same('ISO 14001'), same('ISO 45001'), same('ISO 22000'), same('ISO 27001'), same('ISO 13485'), same('ISO 20000'),
      same('ISO 17025:2017'), same('ISO 16603:2004'), same('ISO 22612:2005'), same('ISO 10002:2018'),
      same('HACCP'), same('GMP'), same('WHO-GMP'), same('FDA'), same('CE Mark'), same('RoHS'), same('BIFMA'),
      ['Halal certification', 'हलाल प्रमाणपत्र'], ['Green Certificate', 'ग्रीन सर्टिफिकेट'], same('SEDEX'), same('BRC'), ['CMMI Level 3 & 5', 'CMMI लेवल 3 और 5'],
    ],
  },
  {
    slug: 'funding-assistance',
    icon: 'Landmark',
    title: { en: 'Funding Assistance', hi: 'फंडिंग सहायता' },
    summary: { en: 'Recognition, loans and registrations that help a young business raise money.', hi: 'मान्यता, ऋण और पंजीकरण जो नए व्यवसाय को पूँजी जुटाने में मदद करते हैं।' },
    how: {
      en: ['We check which scheme fits your business and its turnover.', 'Applications and supporting papers are prepared to what lenders ask for.', 'We follow up with the portal or bank until a decision comes.'],
      hi: ['हम जाँचते हैं कि आपके व्यवसाय और टर्नओवर के लिए कौन सी योजना उपयुक्त है।', 'आवेदन और सहायक कागज़ात वैसे तैयार होते हैं जैसा ऋणदाता माँगते हैं।', 'निर्णय आने तक हम पोर्टल या बैंक से पूछताछ करते रहते हैं।'],
    },
    items: [
      ['Start-Up recognition', 'स्टार्ट-अप मान्यता'], ['Mudra loan', 'मुद्रा ऋण'], ['59-minute MSME loan', '59 मिनट MSME ऋण'], ['NITI Aayog registration', 'नीति आयोग पंजीकरण'],
    ],
  },
  {
    slug: 'legal-drafting',
    icon: 'ScrollText',
    title: { en: 'Legal Drafting', hi: 'कानूनी ड्राफ्टिंग' },
    summary: { en: 'Clear, enforceable agreements and project documents, drafted to your situation.', hi: 'स्पष्ट और लागू करने योग्य अनुबंध व परियोजना दस्तावेज़, आपकी स्थिति के अनुसार तैयार।' },
    how: {
      en: ['We start from what you actually agreed, not a generic template.', 'Clauses are written plainly so both sides understand them.', 'One round of changes is included before the final copy.'],
      hi: ['हम सामान्य टेम्पलेट से नहीं, बल्कि आपने वास्तव में जो तय किया उससे शुरू करते हैं।', 'धाराएँ सरल भाषा में लिखी जाती हैं ताकि दोनों पक्ष समझ सकें।', 'अंतिम प्रति से पहले एक बार बदलाव शामिल है।'],
    },
    items: [
      ['MOU', 'MOU'], ['Legal agreement', 'कानूनी अनुबंध'], ['Joint venture agreement', 'संयुक्त उद्यम अनुबंध'], ['Project report', 'प्रोजेक्ट रिपोर्ट'],
      ['NDA', 'NDA'], ['Lease deed', 'लीज़ डीड'], ['Employees agreement', 'कर्मचारी अनुबंध'], ['Terms & conditions', 'नियम और शर्तें'],
    ],
  },
  {
    slug: 'licences-ipr-advisory',
    icon: 'Lightbulb',
    title: { en: 'Business Licences, IPR & Advisory', hi: 'व्यावसायिक लाइसेंस, IPR और सलाह' },
    summary: { en: 'Licences, trademarks and patents, plus tender roadmaps and NCB key points.', hi: 'लाइसेंस, ट्रेडमार्क और पेटेंट, साथ में टेंडर रोडमैप और NCB प्रमुख बिंदु।' },
    how: {
      en: ['We identify the licences your activity needs and where to apply.', 'Intellectual property is searched and filed so your name and work are protected.', 'Advisory notes turn a tender\'s conditions into a short, practical plan.'],
      hi: ['हम बताते हैं कि आपकी गतिविधि के लिए कौन से लाइसेंस चाहिए और कहाँ आवेदन करना है।', 'बौद्धिक संपदा की खोज और फाइलिंग होती है ताकि आपका नाम और काम सुरक्षित रहे।', 'सलाह नोट टेंडर की शर्तों को छोटी, व्यावहारिक योजना में बदल देते हैं।'],
    },
    items: [
      ['Licence advisory', 'लाइसेंस सलाह'], ['Trademark support', 'ट्रेडमार्क सहायता'], ['Copyright support', 'कॉपीराइट सहायता'], ['Patent support', 'पेटेंट सहायता'],
      ['Tender Roadmap', 'टेंडर रोडमैप'], ['NCB Key Points', 'NCB प्रमुख बिंदु'],
    ],
  },
];

/** Same copy for every item of a group, built around the item's name. */
const LEAD = {
  en: (name, group) => `${name} is part of our ${group} service. Tell us what you need and our team will explain the steps, the documents required and the time it usually takes, before you commit to anything.`,
  hi: (name, group) => `${name} हमारी "${group}" सेवा का हिस्सा है। आप अपनी ज़रूरत बताएँ, हमारी टीम कोई भी प्रतिबद्धता लेने से पहले चरण, ज़रूरी दस्तावेज़ और सामान्य समय समझा देगी।`,
};
export const leadFor = (lang, name, group) => LEAD[lang === 'HI' ? 'hi' : 'en'](name, group);

export const itemsOf = (group) => group.items.map(([en, hi]) => ({ slug: slugify(en), en, hi }));
export const findGroup = (slug) => GROUPS.find((g) => g.slug === slug) ?? null;
export function findItem(groupSlug, itemSlug) {
  const group = findGroup(groupSlug);
  const item = group && itemsOf(group).find((i) => i.slug === itemSlug);
  return item ? { group, item } : null;
}
export const allPaths = () => ['/', '/services', '/about', '/contact', '/request-access', '/privacy', '/terms', '/disclaimer', ...GROUPS.flatMap((g) => [`/services/${g.slug}`, ...itemsOf(g).map((i) => `/services/${g.slug}/${i.slug}`)])];

export const SERVICE_COUNT = GROUPS.reduce((n, g) => n + g.items.length, 0);

/** The nine steps of how a tender is taken through the Shan-Deep desk, for the interactive chart. */
export const FLOW = [
  { key: 'intake', en: ['Request', 'You pick a tender and ask us to handle it.'], hi: ['अनुरोध', 'आप टेंडर चुनते हैं और हमसे संभालने को कहते हैं।'] },
  { key: 'study', en: ['Detail study', 'We read the full tender and send you a plain-language summary.'], hi: ['विस्तृत अध्ययन', 'हम पूरा टेंडर पढ़ते हैं और आपको सरल भाषा में सारांश भेजते हैं।'] },
  { key: 'eligibility', en: ['Eligibility', 'Every criterion is checked as met or not met, before you spend on the bid.'], hi: ['पात्रता', 'बोली पर खर्च से पहले हर मानदंड की जाँच: पूरा या नहीं।'] },
  { key: 'technical', en: ['Technical bid', 'Forms, certificates and declarations are prepared against a checklist.'], hi: ['तकनीकी बोली', 'फॉर्म, प्रमाणपत्र और घोषणाएँ चेकलिस्ट के अनुसार तैयार होती हैं।'] },
  { key: 'financial', en: ['Financial strategy', 'Your price is set with past winning rates in view.'], hi: ['वित्तीय रणनीति', 'पिछली जीतने वाली दरों को देखकर आपकी कीमत तय होती है।'] },
  { key: 'prebid', en: ['Pre-bid queries', 'Doubts are raised with the department and answers recorded.'], hi: ['प्री-बिड प्रश्न', 'विभाग से शंकाएँ पूछी जाती हैं और उत्तर दर्ज होते हैं।'] },
  { key: 'submission', en: ['Submission', 'Submitted online or by courier, with proof kept for you.'], hi: ['जमा करना', 'ऑनलाइन या कूरियर से जमा, और प्रमाण आपके लिए रखा जाता है।'] },
  { key: 'result', en: ['Opening & result', 'We follow technical and financial opening and tell you where you stand.'], hi: ['खोलना और परिणाम', 'हम तकनीकी और वित्तीय खुलने का पालन करते हैं और स्थिति बताते हैं।'] },
  { key: 'followup', en: ['Follow-up', 'EMD refund if not L1; purchase order and payment follow-up if L1.'], hi: ['अनुवर्ती', 'L1 न होने पर EMD वापसी; L1 होने पर क्रय आदेश और भुगतान की पूछताछ।'] },
];

/** Departments whose tenders the portal covers. Plain names only: no logo is shown until the client supplies approved artwork. */
export const DEPARTMENTS = [
  'Public Works Department', 'Public Health Engineering', 'Indian Railways', 'National Highways Authority of India', 'Rural Development',
  'Water Resources', 'Municipal Corporations', 'Smart City Missions', 'Health & Family Welfare', 'Education Departments', 'State Electricity Boards', 'Defence & Ordnance',
];
