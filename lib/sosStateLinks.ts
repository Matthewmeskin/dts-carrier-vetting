// Direct Secretary-of-State (or equivalent) business-entity search URLs by
// state, used as a fallback link when OpenSOS doesn't return a source URL.
// A few states have no SoS office — the business registry lives with another
// agency (Lt. Governor, DCCA, DLCP); those are included under the state code.
// These are the best-known public search pages; if a state ever moves its
// search, this map is the one place to update.

const STATE_SOS_SEARCH: Record<string, string> = {
  AL: 'https://arc-sos.state.al.us/CGI/CORPNAME.MBR/INPUT',
  AK: 'https://www.commerce.alaska.gov/cbp/main/search/entities',
  AZ: 'https://ecorp.azcc.gov/EntitySearch/Index',
  AR: 'https://www.sos.arkansas.gov/corps/search_all.php',
  CA: 'https://bizfileonline.sos.ca.gov/search/business',
  CO: 'https://www.coloradosos.gov/biz/BusinessEntityCriteriaExt.do',
  CT: 'https://service.ct.gov/business/s/onlinebusinesssearch',
  DE: 'https://icis.corp.delaware.gov/ecorp/entitysearch/NameSearch.aspx',
  DC: 'https://corponline.dcra.dc.gov/Home.aspx/Landing',
  FL: 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByName',
  GA: 'https://ecorp.sos.ga.gov/BusinessSearch',
  HI: 'https://hbe.ehawaii.gov/documents/search.html',
  ID: 'https://sosbiz.idaho.gov/search/business',
  IL: 'https://apps.ilsos.gov/businessentitysearch/',
  IN: 'https://bsd.sos.in.gov/publicbusinesssearch',
  IA: 'https://sos.iowa.gov/search/business/search.aspx',
  KS: 'https://www.sos.ks.gov/eforms/BusinessEntity/Search.aspx',
  KY: 'https://web.sos.ky.gov/bussearchnprofile/',
  LA: 'https://coraweb.sos.la.gov/CommercialSearch/CommercialSearch.aspx',
  ME: 'https://icrs.informe.org/nei-sos-icrs/ICRS?MainPage=x',
  MD: 'https://egov.maryland.gov/BusinessExpress/EntitySearch',
  MA: 'https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx',
  MI: 'https://cofs.lara.state.mi.us/SearchApi/Search/Search',
  MN: 'https://mblsportal.sos.state.mn.us/Business/Search',
  MS: 'https://corp.sos.ms.gov/corp/portal/c/portal/layout?p_l_id=PUB.1.4',
  MO: 'https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx',
  MT: 'https://biz.sosmt.gov/search/business',
  NE: 'https://www.nebraska.gov/sos/corp/corpsearch.cgi',
  NV: 'https://esos.nv.gov/EntitySearch/OnlineEntitySearch',
  NH: 'https://quickstart.sos.nh.gov/online/BusinessInquire',
  NJ: 'https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName',
  NM: 'https://portal.sos.state.nm.us/BFS/online/CorporationBusinessSearch',
  NY: 'https://apps.dos.ny.gov/publicInquiry/',
  NC: 'https://www.sosnc.gov/online_services/search/by_title/_Business_Registration',
  ND: 'https://firststop.sos.nd.gov/search/business',
  OH: 'https://businesssearch.ohiosos.gov/',
  OK: 'https://www.sos.ok.gov/corp/corpInquiryFind.aspx',
  OR: 'https://egov.sos.state.or.us/br/pkg_web_name_srch_inq.login',
  PA: 'https://file.dos.pa.gov/search/business',
  RI: 'https://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx',
  SC: 'https://businessfilings.sc.gov/BusinessFiling/Entity/Search',
  SD: 'https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx',
  TN: 'https://tnbear.tn.gov/Ecommerce/FilingSearch.aspx',
  TX: 'https://mycpa.cpa.state.tx.us/coa/',
  UT: 'https://secure.utah.gov/bes/',
  VT: 'https://bizfilings.vermont.gov/online/BusinessInquire/',
  VA: 'https://cis.scc.virginia.gov/EntitySearch/Index',
  WA: 'https://ccfs.sos.wa.gov/#/BusinessSearch',
  WV: 'https://apps.wv.gov/SOS/BusinessEntitySearch/',
  WI: 'https://www.wdfi.org/apps/CorpSearch/Search.aspx',
  WY: 'https://wyobiz.wyo.gov/Business/FilingSearch.aspx',
}

/** Direct business-entity search URL for a state (2-letter code), or null. */
export function stateSosSearchUrl(state: string | null | undefined): string | null {
  const s = String(state ?? '').trim().toUpperCase()
  return STATE_SOS_SEARCH[s] ?? null
}
