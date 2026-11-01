/**
 * Registry of Indian government e-procurement portals.
 *
 * Almost every central and state portal runs NIC's "GePNIC" software, so one
 * browser adapter (browser.js) + parser (parseListPage) + normalizer
 * (normalizeCpppTender) cover them all — only the host and the app context path
 * differ (CPPP/etenders use /eprocure/app, the rest use /nicgep/app).
 *
 * Hosts/paths were taken from a maintained open-source registry and each host's
 * robots.txt was checked (2026-10-30): all enabled hosts allow crawling. The
 * crawler reads only the captcha-free "Tenders by Closing Date" listing.
 *
 * Disabled entries are portals that must not be crawled (robots.txt) or that run
 * non-GePNIC software needing their own adapter — noted per entry.
 */

const listQuery = '?page=FrontEndListTendersbyDate&service=page';

/** @type {{id,name,state,type,baseUrl,appPath,enabled,note?}[]} */
export const GEPNIC_PORTALS = [
  // --- Central portals & PSUs ----------------------------------------------
  { id: 'cppp', name: 'CPPP (Central Public Procurement Portal)', state: null, type: 'central_portal', baseUrl: 'https://eprocure.gov.in', appPath: '/eprocure/app', enabled: true },
  { id: 'etenders', name: 'Central eTenders (MoRTH/NHAI etc.)', state: null, type: 'central_portal', baseUrl: 'https://etenders.gov.in', appPath: '/eprocure/app', enabled: true },
  { id: 'defence', name: 'Defence (defproc)', state: null, type: 'central_portal', baseUrl: 'https://defproc.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'coalindia', name: 'Coal India', state: null, type: 'psu_direct', baseUrl: 'https://coalindiatenders.nic.in', appPath: '/nicgep/app', enabled: true },
  { id: 'ntpc', name: 'NTPC', state: null, type: 'psu_direct', baseUrl: 'https://eprocurentpc.nic.in', appPath: '/nicgep/app', enabled: true },
  // The rest of GePNIC's public-sector-enterprise deployments. Each was probed
  // on 2026-11-01 and serves the same captcha-free listing as the others.
  { id: 'iocl', name: 'IndianOil (IOCL)', state: null, type: 'psu_direct', baseUrl: 'https://iocletenders.nic.in', appPath: '/nicgep/app', enabled: true },
  { id: 'bhel', name: 'BHEL', state: null, type: 'psu_direct', baseUrl: 'https://eprocurebhel.co.in', appPath: '/nicgep/app', enabled: true },
  { id: 'bel', name: 'Bharat Electronics (BEL)', state: null, type: 'psu_direct', baseUrl: 'https://eprocurebel.co.in', appPath: '/nicgep/app', enabled: true },
  { id: 'mazagondock', name: 'Mazagon Dock Shipbuilders', state: null, type: 'psu_direct', baseUrl: 'https://eprocuremdl.nic.in', appPath: '/nicgep/app', enabled: true },
  { id: 'grse', name: 'Garden Reach Shipbuilders (GRSE)', state: null, type: 'psu_direct', baseUrl: 'https://eprocuregrse.co.in', appPath: '/nicgep/app', enabled: true },
  { id: 'hsl', name: 'Hindustan Shipyard', state: null, type: 'psu_direct', baseUrl: 'https://eprocurehsl.nic.in', appPath: '/nicgep/app', enabled: true },
  { id: 'goashipyard', name: 'Goa Shipyard', state: null, type: 'psu_direct', baseUrl: 'https://eprocuregsl.nic.in', appPath: '/nicgep/app', enabled: true },
  { id: 'cpcl', name: 'Chennai Petroleum (CPCL)', state: null, type: 'psu_direct', baseUrl: 'https://cpcletenders.nic.in', appPath: '/nicgep/app', enabled: true },
  { id: 'midhani', name: 'Midhani', state: null, type: 'psu_direct', baseUrl: 'https://eprocuremidhani.nic.in', appPath: '/nicgep/app', enabled: true },

  // --- State / UT portals (GePNIC) -----------------------------------------
  { id: 'mp', name: 'Madhya Pradesh', state: 'Madhya Pradesh', type: 'state_portal', baseUrl: 'https://mptenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'up', name: 'Uttar Pradesh', state: 'Uttar Pradesh', type: 'state_portal', baseUrl: 'https://etender.up.nic.in', appPath: '/nicgep/app', enabled: true },
  { id: 'rajasthan', name: 'Rajasthan', state: 'Rajasthan', type: 'state_portal', baseUrl: 'https://eproc.rajasthan.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'tamilnadu', name: 'Tamil Nadu', state: 'Tamil Nadu', type: 'state_portal', baseUrl: 'https://tntenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'odisha', name: 'Odisha', state: 'Odisha', type: 'state_portal', baseUrl: 'https://tendersodisha.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'kerala', name: 'Kerala', state: 'Kerala', type: 'state_portal', baseUrl: 'https://etenders.kerala.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'westbengal', name: 'West Bengal', state: 'West Bengal', type: 'state_portal', baseUrl: 'https://wbtenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'jharkhand', name: 'Jharkhand', state: 'Jharkhand', type: 'state_portal', baseUrl: 'https://jharkhandtenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'haryana', name: 'Haryana', state: 'Haryana', type: 'state_portal', baseUrl: 'https://etenders.hry.nic.in', appPath: '/nicgep/app', enabled: true },
  { id: 'punjab', name: 'Punjab', state: 'Punjab', type: 'state_portal', baseUrl: 'https://eproc.punjab.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'himachal', name: 'Himachal Pradesh', state: 'Himachal Pradesh', type: 'state_portal', baseUrl: 'https://hptenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'uttarakhand', name: 'Uttarakhand', state: 'Uttarakhand', type: 'state_portal', baseUrl: 'https://uktenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'goa', name: 'Goa', state: 'Goa', type: 'state_portal', baseUrl: 'https://eprocure.goa.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'assam', name: 'Assam', state: 'Assam', type: 'state_portal', baseUrl: 'https://assamtenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'jammukashmir', name: 'Jammu & Kashmir', state: 'Jammu and Kashmir', type: 'state_portal', baseUrl: 'https://jktenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'delhi', name: 'Delhi', state: 'Delhi', type: 'state_portal', baseUrl: 'https://govtprocurement.delhi.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'chandigarh', name: 'Chandigarh', state: 'Chandigarh', type: 'state_portal', baseUrl: 'https://etenders.chd.nic.in', appPath: '/nicgep/app', enabled: true },
  { id: 'tripura', name: 'Tripura', state: 'Tripura', type: 'state_portal', baseUrl: 'https://tripuratenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'manipur', name: 'Manipur', state: 'Manipur', type: 'state_portal', baseUrl: 'https://manipurtenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'meghalaya', name: 'Meghalaya', state: 'Meghalaya', type: 'state_portal', baseUrl: 'https://meghalayatenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'mizoram', name: 'Mizoram', state: 'Mizoram', type: 'state_portal', baseUrl: 'https://mizoramtenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'nagaland', name: 'Nagaland', state: 'Nagaland', type: 'state_portal', baseUrl: 'https://nagalandtenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'sikkim', name: 'Sikkim', state: 'Sikkim', type: 'state_portal', baseUrl: 'https://sikkimtender.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'arunachal', name: 'Arunachal Pradesh', state: 'Arunachal Pradesh', type: 'state_portal', baseUrl: 'https://arunachaltenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'puducherry', name: 'Puducherry', state: 'Puducherry', type: 'state_portal', baseUrl: 'https://pudutenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'andaman', name: 'Andaman & Nicobar', state: 'Andaman and Nicobar Islands', type: 'state_portal', baseUrl: 'https://eprocure.andamannicobar.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'dnhdd', name: 'DNH & Daman Diu', state: 'Dadra and Nagar Haveli and Daman and Diu', type: 'state_portal', baseUrl: 'https://ddtenders.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'ladakh', name: 'Ladakh', state: 'Ladakh', type: 'state_portal', baseUrl: 'https://tenders.ladakh.gov.in', appPath: '/nicgep/app', enabled: true },
  { id: 'lakshadweep', name: 'Lakshadweep', state: 'Lakshadweep', type: 'state_portal', baseUrl: 'https://tendersutl.gov.in', appPath: '/nicgep/app', enabled: true },

  // --- Must not crawl / not plain GePNIC: need their own handling -----------
  { id: 'maharashtra', name: 'Maharashtra (mahatenders)', state: 'Maharashtra', type: 'state_portal', baseUrl: 'https://mahatenders.gov.in', appPath: '/nicgep/app', enabled: false, note: 'robots.txt: Disallow / (verified 2026-10-30)' },
  { id: 'karnataka', name: 'Karnataka (KPPP)', state: 'Karnataka', type: 'state_portal', baseUrl: 'https://kppp.karnataka.gov.in', appPath: '/', enabled: false, note: 'tender listing behind a Keycloak login' },
  { id: 'gujarat', name: 'Gujarat (nProcure)', state: 'Gujarat', type: 'state_portal', baseUrl: 'https://tender.nprocure.com', appPath: '/', adapter: 'nprocure', enabled: true },
  { id: 'bihar', name: 'Bihar', state: 'Bihar', type: 'state_portal', baseUrl: 'https://eproc2.bihar.gov.in', appPath: '/', adapter: 'bihar', enabled: true },
  { id: 'andhra', name: 'Andhra Pradesh', state: 'Andhra Pradesh', type: 'state_portal', baseUrl: 'https://tender.apeprocurement.gov.in', appPath: '/', adapter: 'vupadhi', enabled: true },
  { id: 'telangana', name: 'Telangana', state: 'Telangana', type: 'state_portal', baseUrl: 'https://tender.telangana.gov.in', appPath: '/', adapter: 'vupadhi', enabled: true },
  { id: 'chhattisgarh', name: 'Chhattisgarh', state: 'Chhattisgarh', type: 'state_portal', baseUrl: 'https://eproc.cgstate.gov.in', appPath: '/', enabled: false, note: 'text captcha required — cannot automate without circumvention' },
  { id: 'ireps', name: 'IREPS (Indian Railways)', state: null, type: 'psu_direct', baseUrl: 'https://www.ireps.gov.in', appPath: '/', enabled: false, note: 'robots.txt: Disallow / (verified 2026-11-01)' },
];

/** Build the per-portal options the browser client / runner need. */
export function portalClientOptions(portal) {
  return {
    baseUrl: portal.baseUrl,
    startPath: portal.appPath,
    listPath: `${portal.appPath}${listQuery}`,
    tableSelector: '#table',
    state: portal.state ?? null,
  };
}

export const enabledPortals = () => GEPNIC_PORTALS.filter((p) => p.enabled);
