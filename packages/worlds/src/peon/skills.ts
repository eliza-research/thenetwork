// peon.biz world ontology: role families mapped to O*NET-SOC 2019 occupation codes, with skills
// named after O*NET / ESCO skill and knowledge elements (simplified ids). Pay mid-points are
// round-number approximations of national medians (BLS OES / O*NET wages), scaled per seniority
// level and market. Supply and demand shares are set so that tech roles are swamped and care,
// logistics, accounting and sales roles are under-applied (domain research B2, Horton 2017).
import type { City } from "@thenetwork/core";

export interface Family {
  id: string; soc: string; title: string;
  /** Six skills; the first three are core (most must-haves come from them). */
  skills: string[];
  /** Median pay at seniority 3, $k per year (US). */
  pay: number;
  /** Share of candidates / jobs in this family. */
  candShare: number; jobShare: number;
  /** Share of jobs that are remote. */
  remote: number;
  /** A job-related licence some jobs require: id, share of jobs that require it, share of candidates who hold it. */
  cred?: { id: string; jobs: number; holders: number };
  /** Adjacent family (second stated target for some candidates). */
  adjacent: string;
}

export const FAMILIES: Family[] = [
  { id: "software_engineer", soc: "15-1252", title: "Software Engineer", skills: ["javascript", "python", "system_design", "sql", "cloud", "testing"], pay: 140, candShare: 0.24, jobShare: 0.14, remote: 0.45, adjacent: "data_analyst" },
  { id: "data_analyst", soc: "15-2051", title: "Data Analyst", skills: ["sql", "statistics", "python", "excel", "tableau", "machine_learning"], pay: 105, candShare: 0.18, jobShare: 0.12, remote: 0.35, adjacent: "software_engineer" },
  { id: "accountant", soc: "13-2011", title: "Accountant", skills: ["gaap", "reconciliation", "excel", "tax", "quickbooks", "audit"], pay: 85, candShare: 0.07, jobShare: 0.12, remote: 0.2, cred: { id: "cpa", jobs: 0.2, holders: 0.3 }, adjacent: "data_analyst" },
  { id: "registered_nurse", soc: "29-1141", title: "Registered Nurse", skills: ["patient_care", "medication_admin", "ehr", "triage", "iv_therapy", "care_planning"], pay: 105, candShare: 0.06, jobShare: 0.14, remote: 0, cred: { id: "rn", jobs: 1, holders: 1 }, adjacent: "customer_support" },
  { id: "customer_support", soc: "43-4051", title: "Customer Support Specialist", skills: ["communication", "crm", "ticketing", "deescalation", "troubleshooting", "excel"], pay: 52, candShare: 0.13, jobShare: 0.1, remote: 0.3, adjacent: "sales_rep" },
  { id: "sales_rep", soc: "41-4012", title: "Sales Representative", skills: ["prospecting", "crm", "negotiation", "closing", "account_management", "communication"], pay: 75, candShare: 0.1, jobShare: 0.13, remote: 0.2, adjacent: "customer_support" },
  { id: "warehouse_logistics", soc: "53-7062", title: "Warehouse Associate", skills: ["inventory", "shipping", "safety_compliance", "forklift", "scheduling", "cdl_driving"], pay: 48, candShare: 0.08, jobShare: 0.15, remote: 0, cred: { id: "cdl", jobs: 0.25, holders: 0.35 }, adjacent: "customer_support" },
];
export const FAMILY = new Map(FAMILIES.map(f => [f.id, f]));

export const LEVEL_TITLE = ["", "Associate", "", "Senior", "Lead", "Principal"];
export const SENIORITY_PAY = [0, 0.72, 0.86, 1, 1.22, 1.45];
export const MARKET_PAY: Record<City, number> = { sf: 1.12, nyc: 1.06, la: 1.08 }; // la: not modelled by the hiring world yet
export const REMOTE_PAY = 1.0;

/** Median pay ($k) for a family, seniority and market (remote = undefined). */
export function payMid(family: string, seniority: number, market?: City): number {
  const f = FAMILY.get(family)!;
  return f.pay * SENIORITY_PAY[seniority]! * (market ? MARKET_PAY[market] : REMOTE_PAY);
}

/**
 * Commute areas per market. A candidate lives in one area (home zip is a proxy and stays sealed /
 * agent_private) and states the areas they will commute to; jobs have a site area.
 */
export const AREAS: Record<City, { id: string; jobWeight: number; neighbours: string[] }[]> = {
  nyc: [
    { id: "manhattan", jobWeight: 0.55, neighbours: ["brooklyn", "queens", "bronx", "jersey_city"] },
    { id: "brooklyn", jobWeight: 0.18, neighbours: ["manhattan", "queens"] },
    { id: "queens", jobWeight: 0.12, neighbours: ["manhattan", "brooklyn", "bronx"] },
    { id: "bronx", jobWeight: 0.07, neighbours: ["manhattan", "queens"] },
    { id: "jersey_city", jobWeight: 0.08, neighbours: ["manhattan"] },
  ],
  sf: [
    { id: "san_francisco", jobWeight: 0.45, neighbours: ["oakland", "peninsula"] },
    { id: "oakland", jobWeight: 0.2, neighbours: ["san_francisco", "east_bay"] },
    { id: "east_bay", jobWeight: 0.1, neighbours: ["oakland"] },
    { id: "peninsula", jobWeight: 0.12, neighbours: ["san_francisco", "south_bay"] },
    { id: "south_bay", jobWeight: 0.13, neighbours: ["peninsula"] },
  ],
  la: [], // the hiring world does not model LA yet
};

/** Zip codes per area (proxies only; never in a matchable or shareable facet). */
export const ZIPS: Record<string, string[]> = {
  manhattan: ["10001", "10025", "10027", "10029", "10032"], brooklyn: ["11201", "11207", "11211", "11226", "11233"],
  queens: ["11101", "11368", "11373", "11432", "11691"], bronx: ["10451", "10456", "10462", "10467", "10472"],
  jersey_city: ["07302", "07304", "07305", "07306", "07307"],
  san_francisco: ["94103", "94110", "94112", "94117", "94124"], oakland: ["94601", "94606", "94607", "94610", "94621"],
  east_bay: ["94530", "94544", "94545", "94577", "94804"], peninsula: ["94010", "94025", "94063", "94066", "94403"],
  south_bay: ["95014", "95035", "95111", "95122", "95127"],
};
