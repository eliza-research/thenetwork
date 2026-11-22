# Confirm a Peon job search

## Story: Tell Peon what work to look for

> As an adult candidate, I want to review and confirm what Peon will look for before I can receive an introduction.

### Only the current adult Peon member can manage this search

Accept a job-search command only in the verified member's own signed Peon conversation. Check current account status, safety holds, age and the member's work-introduction preference again for every action. This saves the person's own search. It does not authorize contact, publish a slate, change send limits or switch on live hiring.

```quint
pure def peonSearchOwner(appName: str, signedDirect: bool, liveAccount: bool, adult: bool, workAllowed: bool): bool =
  appName == "peon" and signedDirect and liveAccount and adult and workAllowed

pure def lawPeonSearchRequiresCurrentAdult(liveAccount: bool, adult: bool, workAllowed: bool): bool =
  peonSearchOwner("peon", true, liveAccount, adult, workAllowed) implies (liveAccount and adult and workAllowed)
```

### Use the local hiring catalogue and the stated work terms

The local pilot uses the occupational families and skills already modeled by Peon. Accept a catalogue role, a stated experience level, a US-dollar yearly minimum, and the types of workplace the candidate accepts. Onsite and hybrid work need an explicitly accepted commute area. Skills are optional and self-claimed. The candidate may state a private company exclusion, sponsorship preference or when they can start. Keep an omitted value unknown. Never turn sensitive data, proxy fields, or free-form profile text into hiring criteria.

```quint
pure val peonSearchRoles = Set("software_engineer", "data_analyst", "accountant", "registered_nurse",
  "customer_support", "sales_rep", "warehouse_logistics")
pure val peonSearchSkills = Set("javascript", "python", "system_design", "sql", "cloud", "testing",
  "statistics", "excel", "tableau", "machine_learning", "gaap", "reconciliation", "tax", "quickbooks", "audit",
  "patient_care", "medication_admin", "ehr", "triage", "iv_therapy", "care_planning", "communication", "crm",
  "ticketing", "deescalation", "troubleshooting", "prospecting", "negotiation", "closing", "account_management",
  "inventory", "shipping", "safety_compliance", "forklift", "scheduling", "cdl_driving")
pure val peonSearchAreas = Set("manhattan", "brooklyn", "queens", "bronx", "jersey_city",
  "san_francisco", "oakland", "east_bay", "peninsula", "south_bay")
pure val peonSearchModes = Set("remote", "hybrid", "onsite")

pure def peonSearchTermsAllowed(roleKnown: bool, level: int, floorCents: int, hasMode: bool,
    needsArea: bool, hasArea: bool): bool =
  roleKnown and level >= 1 and level <= 5 and floorCents >= 0 and floorCents <= 99900000
    and hasMode and (not(needsArea) or hasArea)

pure def peonSearchSkillAllowed(skillKnown: bool, level: int): bool =
  skillKnown and level >= 0 and level <= 5

pure def peonSearchStartAllowed(weeks: int): bool = weeks >= 0 and weeks <= 52
```

### Read back the whole draft and accept only its exact confirmation

Keep one private draft per member for 15 minutes. A new draft replaces the earlier one. A command confirming the draft must quote its exact reference and arrive after the draft and before the deadline. The current member can discard the draft. An ordinary affirmative reply, a late response or an older reference cannot save it. Store the accepted facts and active search together with the confirmation reply. Replace only facts from this candidate search. The normal standing-intent controls can pause or close the search. Its normal intent horizon is 90 days.

```quint
pure val peonSearchDraftMs = 900000
pure val peonSearchHorizonDays = 90

pure def peonSearchTurnCurrent(received: int, at: int): bool =
  received >= 0 and received <= at and at - received < peonSearchDraftMs

pure def peonSearchConfirmable(sameReference: bool, staged: int, received: int, at: int): bool =
  sameReference and staged >= 0 and staged <= received and received <= at and at - staged < peonSearchDraftMs

pure def lawOldPeonSearchReferenceCannotSave(staged: int, received: int, at: int): bool =
  not(peonSearchConfirmable(false, staged, received, at))

pure def lawExpiredPeonSearchCannotSave(staged: int, received: int): bool =
  not(peonSearchConfirmable(true, staged, received, staged + peonSearchDraftMs))
```
