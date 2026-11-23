/**
 * Industry options for the registration form's "Industry / business type"
 * dropdown. `value` is the canonical label stored and used for matching, and
 * MUST stay in sync with backend/src/content/industries.js. `hi` is the Hindi
 * label shown when the site language is Hindi; the stored value stays English so
 * matching is language-independent.
 */
export const INDUSTRIES = [
  { value: 'Information Technology & Hardware', hi: 'सूचना प्रौद्योगिकी और हार्डवेयर' },
  { value: 'CCTV & Security Systems', hi: 'सीसीटीवी और सुरक्षा प्रणाली' },
  { value: 'Electrical Equipment & Supplies', hi: 'विद्युत उपकरण और आपूर्ति' },
  { value: 'Civil Construction & Works', hi: 'सिविल निर्माण और कार्य' },
  { value: 'Furniture & Interiors', hi: 'फर्नीचर और इंटीरियर' },
  { value: 'Medical & Healthcare Equipment', hi: 'चिकित्सा और स्वास्थ्य उपकरण' },
  { value: 'Pharmaceuticals & Drugs', hi: 'फार्मास्यूटिकल्स और दवाएँ' },
  { value: 'Office Supplies & Stationery', hi: 'कार्यालय आपूर्ति और स्टेशनरी' },
  { value: 'Housekeeping & Facility Management', hi: 'हाउसकीपिंग और सुविधा प्रबंधन' },
  { value: 'Manpower & Security Services', hi: 'मैनपावर और सुरक्षा सेवाएँ' },
  { value: 'Vehicles & Transport Services', hi: 'वाहन और परिवहन सेवाएँ' },
  { value: 'Water Supply & Sanitation', hi: 'जल आपूर्ति और स्वच्छता' },
  { value: 'HVAC & Air Conditioning', hi: 'एचवीएसी और एयर कंडीशनिंग' },
  { value: 'Solar & Renewable Energy', hi: 'सौर और नवीकरणीय ऊर्जा' },
  { value: 'Laboratory & Scientific Equipment', hi: 'प्रयोगशाला और वैज्ञानिक उपकरण' },
  { value: 'Printing & Publishing', hi: 'मुद्रण और प्रकाशन' },
  { value: 'Agriculture & Allied', hi: 'कृषि और संबद्ध' },
  { value: 'Uniforms & Textiles', hi: 'वर्दी और वस्त्र' },
  { value: 'Food & Catering', hi: 'खाद्य और खानपान' },
  { value: 'Fire & Safety Equipment', hi: 'अग्नि और सुरक्षा उपकरण' },
  { value: 'Consultancy & Professional Services', hi: 'परामर्श और व्यावसायिक सेवाएँ' },
  { value: 'Other', hi: 'अन्य' },
];
