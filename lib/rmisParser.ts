import { XMLParser } from 'fast-xml-parser'
import { stateFromZip } from './sosNormalize'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '_',
  parseTagValue: true,
  trimValues: true,
})

export interface ParsedRMISData {
  // Identity
  rmisCarrierID: string
  dotNumber: string
  mcNumber: string
  legalName: string
  dbaName: string
  headerTimestamp: string
  // Authority
  commonAuthorityStatus: string
  contractAuthorityStatus: string
  brokerAuthorityStatus: string
  operatingStatus: string
  saferActiveStatus: string
  safetyRating: string
  safetyReviewType: string
  authorityOriginalDate: string
  authorityReinstatedDate: string
  authorityRevocationDate: string
  // Insurance
  autoStatus: string
  autoLimit: number
  autoEffectiveDate: string
  autoExpirationDate: string
  autoUnderwriter: string
  autoUnderwriterRating: string
  autoConfidence: string
  autoPolicyNumber: string
  cargoStatus: string
  cargoLimit: number
  cargoEffectiveDate: string
  cargoExpirationDate: string
  cargoUnderwriter: string
  cargoUnderwriterRating: string
  cargoConfidence: string
  cargoPolicyNumber: string
  generalStatus: string
  generalOccurrenceLimit: number
  generalAggregateLimit: number
  generalExpirationDate: string
  // RMIS certification
  rmisIsCertified: boolean
  certificationNotes: string[]
  // Agreement
  brokerCarrierAgreementOnFile: boolean
  brokerCarrierAgreementDate: string
  brokerCarrierAgreementTitle: string
  // W9
  w9OnFile: boolean
  w9TaxID: string
  w9BusinessName: string
  w9CompanyType: string
  // Factoring
  isFactoring: boolean
  payToEntity: string
  payToAddress: string
  // Carrier's real physical/mailing address (NOT the factor pay-to address)
  rmisCarrierStreet: string
  rmisCarrierCity: string
  rmisCarrierState: string
  rmisCarrierZip: string
  // Inspections
  usTotalInspections: number
  usVehicleOOSRatio: string
  usDriverOOSRatio: string
  usVehicleOOSCount: number
  usDriverOOSCount: number
  // Crashes
  usFatalCrashes: number
  usInjuryCrashes: number
  usTowCrashes: number
  usTotalCrashes: number
  // Fleet
  totalPowerUnits: number
}

// Pull a tag's text value straight from the XML string (robust to nesting).
function rawTag(xml: string, name: string): string {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`, 'i').exec(xml)
  return m ? m[1].trim() : ''
}

export function parseRMISXML(xmlString: string): ParsedRMISData {
  const parsed = parser.parse(xmlString)
  const root = parsed.RMISCarrierStatusExpanded

  // Carrier's real address: prefer the FMCSA mailing block, then the business
  // address; derive the state from the ZIP when it isn't given explicitly.
  const rmisCarrierZip =
    rawTag(xmlString, 'Mailing_Zip') || rawTag(xmlString, 'dot_Business_Zip')
  const rmisCarrierState =
    rawTag(xmlString, 'Mailing_State') || stateFromZip(rmisCarrierZip) || ''

  const carrier = root.Carrier ?? {}
  const header = root.Header ?? {}
  const dot = root.DOT ?? {}
  const dotTesting = root.DOTTestingInfo ?? {}
  const coverages = root.Coverages?.Coverage ?? []
  const certStatus = root.CertificationStatus ?? {}
  const agreements = root.ClientCarrierAgreements?.Agreement
  const w9 = root.W9 ?? {}
  const inspections = root.DOTInspectionCollection?.DOTInspections ?? {}
  const crashes = root.DOTCrashCollection?.DOTCrashes ?? {}

  // Normalize coverages to a lookup by type
  const coverageMap: Record<string, any> = {}
  const covArray = Array.isArray(coverages) ? coverages : [coverages]
  for (const cov of covArray) {
    if (cov?.CoverageDescription) {
      coverageMap[cov.CoverageDescription] = cov
    }
  }

  const autoCov = coverageMap['AUTO'] ?? {}
  const cargoCov = coverageMap['CARGO'] ?? {}
  const generalCov = coverageMap['GENERAL'] ?? {}

  // Extract limit amounts
  function getLimitAmount(coverage: any, synonymKey: 'IsAutoSynonym' | 'IsCargoSynonym'): number {
    const limits = coverage?.Limit
    if (!limits) return 0
    const limArray = Array.isArray(limits) ? limits : [limits]
    for (const lim of limArray) {
      if (lim?.[`_${synonymKey}`] === 'True') return Number(lim.LimitAmount) ?? 0
    }
    // Fall back to first limit
    return Number(limArray[0]?.LimitAmount) ?? 0
  }

  function getGeneralLimit(coverage: any, description: string): number {
    const limits = coverage?.Limit
    if (!limits) return 0
    const limArray = Array.isArray(limits) ? limits : [limits]
    const match = limArray.find((l: any) => l?.LimitDescription === description)
    return Number(match?.LimitAmount) ?? 0
  }

  // Certification notes
  const certNotes = certStatus?.CertificationNotes?.Note
  const notesArray = certNotes
    ? Array.isArray(certNotes) ? certNotes : [certNotes]
    : []

  // Agreement (structured section)
  const agreementObj = agreements
    ? Array.isArray(agreements) ? agreements[agreements.length - 1] : agreements
    : null

  // Uploaded documents (RMIS "Documents" list). Many carriers keep their
  // broker-carrier agreement and W-9 here as uploaded PDFs rather than in the
  // structured <ClientCarrierAgreements>/<W9> sections, so we treat a matching
  // document as proof the item is on file too.
  const docList = root.Documents?.Document
  const docArray = docList ? (Array.isArray(docList) ? docList : [docList]) : []
  let docHasAgreement = false
  let docAgreementDate = ''
  let docHasW9 = false
  for (const d of docArray) {
    const desc = String(d?.Description ?? '').toLowerCase()
    if (desc.includes('agreement')) {
      docHasAgreement = true
      if (!docAgreementDate) docAgreementDate = String(d?.CreateDatePST ?? '')
    }
    if (desc.includes('w9') || desc.includes('w-9')) docHasW9 = true
  }

  const structuredAgreement = agreementObj?.Agree === 'Yes'
  const agreementOnFile = structuredAgreement || docHasAgreement
  const w9Structured = !!(w9?.TaxID)
  const w9OnFile = w9Structured || docHasW9

  return {
    rmisCarrierID: String(carrier.RMISCarrierID ?? ''),
    dotNumber: String(carrier.DOTNumber ?? ''),
    mcNumber: String(carrier.MCNumber ?? ''),
    legalName: String(dot.dot_LegalName ?? carrier.CompanyName ?? ''),
    dbaName: String(dot.dot_DBAName ?? carrier.CompanyName ?? ''),
    headerTimestamp: String(header.TimeStampUTC ?? header.TimeStamp ?? ''),

    commonAuthorityStatus: String(dot.dot_CommonAuthority ?? ''),
    contractAuthorityStatus: String(dot.dot_ContractAuthority ?? ''),
    brokerAuthorityStatus: String(dot.dot_BrokerAuthority ?? ''),
    operatingStatus: String(dotTesting.OperatingStatus ?? ''),
    saferActiveStatus: String(dotTesting.Safer_ActiveInactiveStatus ?? ''),
    safetyRating: String(dotTesting.SafetyRating ?? 'None'),
    safetyReviewType: String(dotTesting.SafetyReviewType ?? ''),
    authorityOriginalDate: String(dotTesting.OriginalAuthorityGrantDate ?? ''),
    authorityReinstatedDate: String(dotTesting.LatestAuthorityReinstatedDate ?? ''),
    authorityRevocationDate: String(dotTesting.ContractAuthorityLatestRevocationDate ?? ''),

    autoStatus: String(autoCov.Status ?? 'No-Current-Info'),
    autoLimit: getLimitAmount(autoCov, 'IsAutoSynonym'),
    autoEffectiveDate: String(autoCov.EffectiveDate ?? ''),
    autoExpirationDate: String(autoCov.ExpirationDate ?? ''),
    autoUnderwriter: String(autoCov.Underwriter ?? ''),
    autoUnderwriterRating: String(autoCov.UnderwriterRating ?? ''),
    autoConfidence: String(autoCov.Confidence ?? ''),
    autoPolicyNumber: String(autoCov.PolicyNumber ?? ''),

    cargoStatus: String(cargoCov.Status ?? 'No-Current-Info'),
    cargoLimit: getLimitAmount(cargoCov, 'IsCargoSynonym'),
    cargoEffectiveDate: String(cargoCov.EffectiveDate ?? ''),
    cargoExpirationDate: String(cargoCov.ExpirationDate ?? ''),
    cargoUnderwriter: String(cargoCov.Underwriter ?? ''),
    cargoUnderwriterRating: String(cargoCov.UnderwriterRating ?? ''),
    cargoConfidence: String(cargoCov.Confidence ?? ''),
    cargoPolicyNumber: String(cargoCov.PolicyNumber ?? ''),

    generalStatus: String(generalCov.Status ?? 'No-Current-Info'),
    generalOccurrenceLimit: getGeneralLimit(generalCov, 'Each Occurrence'),
    generalAggregateLimit: getGeneralLimit(generalCov, 'General Aggregate'),
    generalExpirationDate: String(generalCov.ExpirationDate ?? ''),

    rmisIsCertified: certStatus?.IsCertified === 'True' || certStatus?.IsCertified === true,
    certificationNotes: notesArray.map(String),

    brokerCarrierAgreementOnFile: agreementOnFile,
    brokerCarrierAgreementDate: String(agreementObj?.Date ?? docAgreementDate ?? ''),
    brokerCarrierAgreementTitle: String(
      agreementObj?.AgreementTitle ??
        (docHasAgreement ? 'Agreement Document (uploaded to RMIS)' : '')
    ),

    w9OnFile,
    w9TaxID: String(w9['TaxID-EIN'] ?? w9.TaxID ?? ''),
    w9BusinessName: String(w9.BusinessName ?? w9.CoName ?? ''),
    w9CompanyType: String(w9.CompanyType ?? ''),

    isFactoring: carrier.IsFactoring === 'Yes',
    payToEntity: String(carrier.Payto ?? ''),
    payToAddress: String(carrier.PaytoAddress ?? ''),

    rmisCarrierStreet:
      rawTag(xmlString, 'Mailing_Street') || rawTag(xmlString, 'dot_Business_Addr'),
    rmisCarrierCity:
      rawTag(xmlString, 'Mailing_City') || rawTag(xmlString, 'dot_Business_City'),
    rmisCarrierState,
    rmisCarrierZip,

    usTotalInspections: Number(inspections.US_TotalInspections ?? 0),
    usVehicleOOSRatio: String(inspections.US_VehicleOOSRatio ?? '0%'),
    usDriverOOSRatio: String(inspections.US_DriverOOSRatio ?? '0%'),
    usVehicleOOSCount: Number(inspections.US_VehicleOOS ?? 0),
    usDriverOOSCount: Number(inspections.US_DriverOOS ?? 0),

    usFatalCrashes: Number(crashes.US_Fatal ?? 0),
    usInjuryCrashes: Number(crashes.US_Injury ?? 0),
    usTowCrashes: Number(crashes.US_Tow ?? 0),
    usTotalCrashes: Number(crashes.US_Total ?? 0),

    totalPowerUnits: Number(dotTesting.Tot_Pwr ?? 0),
  }
}
