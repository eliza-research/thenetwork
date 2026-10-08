// Zip centroids for slopPack's radius geo (slop.date: "within X miles of a zip"). PRD 40.5 / research
// "location privacy": the Network stores a zip, matches on a COARSE CELL derived from the zip
// centroid (never an address or a GPS fix), and shows distance only as a band ("2-5 mi").
//
// Coverage: the three launch metros. NYC's five boroughs (about 180 residential zips, plus Jersey
// City), San Francisco with the inner East Bay and Peninsula (about 40), and Greater Los Angeles
// (about 120). PO-box-only and single-building zips are left out.
//
// Source: US Census Bureau, 2020 Gazetteer Files, ZIP Code Tabulation Areas
// (https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip),
// a US government work in the public domain. lat/lon are the ZCTA internal points (INTPTLAT /
// INTPTLONG) rounded to 4 decimals (about 10 m), an approximate centroid. The 53 zips of the
// earlier hand-entered table keep their earlier values (rounded to about 0.005 degrees, under 1 km),
// so slop worlds and goldens are unchanged; the slop world still draws home zips from that set
// (SIM_HOME_ZIPS). Area labels are common neighborhood names (agent-side only, never shown with a
// distance). The slop world (packages/worlds/src/slop/geo.ts) reads this same table.
//
// Unknown zips do not fail: the profile falls back to a neighborhood the member named
// (`zipForArea`), and slopPack asks the member for a nearby zip or neighborhood (ask "slop_zip");
// until they answer, the member is held back from radius matching (after a week of silence, the
// market's anchor cell is used, the same as for a visitor). Production may swap in a full zip
// table behind `zipCentroid`.
import type { City } from "@thenetwork/core";

export interface ZipCentroid { zip: string; market: City; area: string; lat: number; lon: number }

export const ZIPS: readonly ZipCentroid[] = [
  // Manhattan
  { zip: "10001", market: "nyc", area: "Chelsea / Hudson Yards", lat: 40.7506, lon: -73.9972 },
  { zip: "10002", market: "nyc", area: "Lower East Side", lat: 40.7157, lon: -73.9863 },
  { zip: "10003", market: "nyc", area: "East Village", lat: 40.7318, lon: -73.9891 },
  { zip: "10004", market: "nyc", area: "Financial District / Battery Park", lat: 40.6889, lon: -74.0182 },
  { zip: "10005", market: "nyc", area: "Financial District", lat: 40.7060, lon: -74.0088 },
  { zip: "10006", market: "nyc", area: "Financial District / World Trade Center", lat: 40.7096, lon: -74.0130 },
  { zip: "10007", market: "nyc", area: "Tribeca / Civic Center", lat: 40.7139, lon: -74.0078 },
  { zip: "10009", market: "nyc", area: "East Village / Alphabet City", lat: 40.7264, lon: -73.9786 },
  { zip: "10010", market: "nyc", area: "Gramercy / Flatiron", lat: 40.7391, lon: -73.9825 },
  { zip: "10011", market: "nyc", area: "Chelsea", lat: 40.7419, lon: -74.0007 },
  { zip: "10012", market: "nyc", area: "SoHo / NoHo", lat: 40.7256, lon: -73.9981 },
  { zip: "10013", market: "nyc", area: "Tribeca / Chinatown", lat: 40.7201, lon: -74.0049 },
  { zip: "10014", market: "nyc", area: "West Village", lat: 40.7340, lon: -74.0054 },
  { zip: "10016", market: "nyc", area: "Murray Hill", lat: 40.7452, lon: -73.9783 },
  { zip: "10017", market: "nyc", area: "Midtown East / Turtle Bay", lat: 40.7524, lon: -73.9725 },
  { zip: "10018", market: "nyc", area: "Garment District", lat: 40.7554, lon: -73.9933 },
  { zip: "10019", market: "nyc", area: "Hell's Kitchen / Midtown West", lat: 40.7658, lon: -73.9873 },
  { zip: "10021", market: "nyc", area: "Upper East Side", lat: 40.7692, lon: -73.9587 },
  { zip: "10022", market: "nyc", area: "Midtown East / Sutton Place", lat: 40.7586, lon: -73.9679 },
  { zip: "10023", market: "nyc", area: "Upper West Side", lat: 40.7764, lon: -73.9827 },
  { zip: "10024", market: "nyc", area: "Upper West Side", lat: 40.7985, lon: -73.9744 },
  { zip: "10025", market: "nyc", area: "Morningside / UWS", lat: 40.7987, lon: -73.9665 },
  { zip: "10026", market: "nyc", area: "Central Harlem", lat: 40.8024, lon: -73.9527 },
  { zip: "10027", market: "nyc", area: "Harlem", lat: 40.8115, lon: -73.9532 },
  { zip: "10028", market: "nyc", area: "Upper East Side", lat: 40.7764, lon: -73.9530 },
  { zip: "10029", market: "nyc", area: "East Harlem", lat: 40.7918, lon: -73.9440 },
  { zip: "10030", market: "nyc", area: "Central Harlem", lat: 40.8183, lon: -73.9429 },
  { zip: "10031", market: "nyc", area: "Hamilton Heights", lat: 40.8253, lon: -73.9500 },
  { zip: "10032", market: "nyc", area: "Washington Heights", lat: 40.8388, lon: -73.9428 },
  { zip: "10033", market: "nyc", area: "Washington Heights", lat: 40.8505, lon: -73.9341 },
  { zip: "10034", market: "nyc", area: "Inwood", lat: 40.8671, lon: -73.9243 },
  { zip: "10035", market: "nyc", area: "East Harlem", lat: 40.7955, lon: -73.9296 },
  { zip: "10036", market: "nyc", area: "Midtown / Times Square", lat: 40.7593, lon: -73.9898 },
  { zip: "10037", market: "nyc", area: "Central Harlem", lat: 40.8130, lon: -73.9374 },
  { zip: "10038", market: "nyc", area: "Financial District / Seaport", lat: 40.7092, lon: -74.0036 },
  { zip: "10039", market: "nyc", area: "Central Harlem", lat: 40.8309, lon: -73.9362 },
  { zip: "10040", market: "nyc", area: "Washington Heights / Fort George", lat: 40.8583, lon: -73.9305 },
  { zip: "10044", market: "nyc", area: "Roosevelt Island", lat: 40.7619, lon: -73.9500 },
  { zip: "10065", market: "nyc", area: "Upper East Side / Lenox Hill", lat: 40.7646, lon: -73.9631 },
  { zip: "10069", market: "nyc", area: "Lincoln Square / Riverside", lat: 40.7760, lon: -73.9903 },
  { zip: "10075", market: "nyc", area: "Upper East Side", lat: 40.7734, lon: -73.9562 },
  { zip: "10128", market: "nyc", area: "Upper East Side / Carnegie Hill", lat: 40.7814, lon: -73.9500 },
  { zip: "10280", market: "nyc", area: "Battery Park City", lat: 40.7091, lon: -74.0164 },
  { zip: "10282", market: "nyc", area: "Battery Park City", lat: 40.7169, lon: -74.0151 },
  // Bronx
  { zip: "10451", market: "nyc", area: "Concourse / Melrose", lat: 40.8205, lon: -73.9248 },
  { zip: "10452", market: "nyc", area: "Highbridge", lat: 40.8374, lon: -73.9234 },
  { zip: "10453", market: "nyc", area: "Morris Heights / University Heights", lat: 40.8523, lon: -73.9135 },
  { zip: "10454", market: "nyc", area: "Mott Haven", lat: 40.8055, lon: -73.9166 },
  { zip: "10455", market: "nyc", area: "Melrose / Longwood", lat: 40.8147, lon: -73.9086 },
  { zip: "10456", market: "nyc", area: "Morrisania", lat: 40.8299, lon: -73.9081 },
  { zip: "10457", market: "nyc", area: "Tremont / Mount Hope", lat: 40.8472, lon: -73.8987 },
  { zip: "10458", market: "nyc", area: "Fordham / Belmont", lat: 40.8625, lon: -73.8882 },
  { zip: "10459", market: "nyc", area: "Longwood", lat: 40.8259, lon: -73.8929 },
  { zip: "10460", market: "nyc", area: "West Farms / Crotona Park East", lat: 40.8418, lon: -73.8796 },
  { zip: "10461", market: "nyc", area: "Morris Park / Westchester Square", lat: 40.8474, lon: -73.8406 },
  { zip: "10462", market: "nyc", area: "Parkchester / Van Nest", lat: 40.8433, lon: -73.8604 },
  { zip: "10463", market: "nyc", area: "Kingsbridge / Spuyten Duyvil", lat: 40.8807, lon: -73.9065 },
  { zip: "10464", market: "nyc", area: "City Island", lat: 40.8696, lon: -73.7958 },
  { zip: "10465", market: "nyc", area: "Throggs Neck", lat: 40.8240, lon: -73.8235 },
  { zip: "10466", market: "nyc", area: "Wakefield", lat: 40.8910, lon: -73.8462 },
  { zip: "10467", market: "nyc", area: "Norwood / Williamsbridge", lat: 40.8700, lon: -73.8658 },
  { zip: "10468", market: "nyc", area: "Kingsbridge Heights / Fordham", lat: 40.8689, lon: -73.9000 },
  { zip: "10469", market: "nyc", area: "Baychester / Eastchester", lat: 40.8686, lon: -73.8481 },
  { zip: "10470", market: "nyc", area: "Woodlawn", lat: 40.8895, lon: -73.8726 },
  { zip: "10471", market: "nyc", area: "Riverdale / Fieldston", lat: 40.8988, lon: -73.9031 },
  { zip: "10472", market: "nyc", area: "Soundview", lat: 40.8296, lon: -73.8693 },
  { zip: "10473", market: "nyc", area: "Clason Point / Castle Hill", lat: 40.8187, lon: -73.8585 },
  { zip: "10474", market: "nyc", area: "Hunts Point", lat: 40.8106, lon: -73.8846 },
  { zip: "10475", market: "nyc", area: "Co-op City", lat: 40.8675, lon: -73.8250 },
  // Brooklyn
  { zip: "11201", market: "nyc", area: "Brooklyn Heights", lat: 40.6943, lon: -73.9903 },
  { zip: "11203", market: "nyc", area: "East Flatbush", lat: 40.6496, lon: -73.9344 },
  { zip: "11204", market: "nyc", area: "Bensonhurst / Mapleton", lat: 40.6188, lon: -73.9848 },
  { zip: "11205", market: "nyc", area: "Fort Greene / Clinton Hill", lat: 40.6947, lon: -73.9662 },
  { zip: "11206", market: "nyc", area: "East Williamsburg", lat: 40.7020, lon: -73.9424 },
  { zip: "11207", market: "nyc", area: "East New York", lat: 40.6708, lon: -73.8942 },
  { zip: "11208", market: "nyc", area: "Cypress Hills / East New York", lat: 40.6686, lon: -73.8710 },
  { zip: "11209", market: "nyc", area: "Bay Ridge", lat: 40.6220, lon: -74.0301 },
  { zip: "11210", market: "nyc", area: "Midwood / Flatbush", lat: 40.6281, lon: -73.9463 },
  { zip: "11211", market: "nyc", area: "Williamsburg", lat: 40.7128, lon: -73.9530 },
  { zip: "11212", market: "nyc", area: "Brownsville", lat: 40.6629, lon: -73.9130 },
  { zip: "11213", market: "nyc", area: "Crown Heights", lat: 40.6711, lon: -73.9363 },
  { zip: "11214", market: "nyc", area: "Bath Beach / Bensonhurst", lat: 40.5991, lon: -73.9961 },
  { zip: "11215", market: "nyc", area: "Park Slope", lat: 40.6681, lon: -73.9860 },
  { zip: "11216", market: "nyc", area: "Bed-Stuy", lat: 40.6806, lon: -73.9493 },
  { zip: "11217", market: "nyc", area: "Boerum Hill / Park Slope", lat: 40.6823, lon: -73.9781 },
  { zip: "11218", market: "nyc", area: "Kensington / Windsor Terrace", lat: 40.6435, lon: -73.9760 },
  { zip: "11219", market: "nyc", area: "Borough Park", lat: 40.6327, lon: -73.9967 },
  { zip: "11220", market: "nyc", area: "Sunset Park", lat: 40.6411, lon: -74.0166 },
  { zip: "11221", market: "nyc", area: "Bushwick / Bed-Stuy", lat: 40.6913, lon: -73.9279 },
  { zip: "11222", market: "nyc", area: "Greenpoint", lat: 40.7290, lon: -73.9480 },
  { zip: "11223", market: "nyc", area: "Gravesend", lat: 40.5971, lon: -73.9734 },
  { zip: "11224", market: "nyc", area: "Coney Island", lat: 40.5774, lon: -73.9887 },
  { zip: "11225", market: "nyc", area: "Crown Heights / Prospect Lefferts", lat: 40.6630, lon: -73.9542 },
  { zip: "11226", market: "nyc", area: "Flatbush", lat: 40.6464, lon: -73.9566 },
  { zip: "11228", market: "nyc", area: "Dyker Heights", lat: 40.6167, lon: -74.0131 },
  { zip: "11229", market: "nyc", area: "Sheepshead Bay / Homecrest", lat: 40.6013, lon: -73.9445 },
  { zip: "11230", market: "nyc", area: "Midwood", lat: 40.6222, lon: -73.9651 },
  { zip: "11231", market: "nyc", area: "Carroll Gardens / Red Hook", lat: 40.6779, lon: -74.0052 },
  { zip: "11232", market: "nyc", area: "Sunset Park / Industry City", lat: 40.6574, lon: -74.0047 },
  { zip: "11233", market: "nyc", area: "Bed-Stuy / Ocean Hill", lat: 40.6783, lon: -73.9199 },
  { zip: "11234", market: "nyc", area: "Marine Park / Bergen Beach", lat: 40.6064, lon: -73.9097 },
  { zip: "11235", market: "nyc", area: "Brighton Beach / Manhattan Beach", lat: 40.5839, lon: -73.9491 },
  { zip: "11236", market: "nyc", area: "Canarsie", lat: 40.6394, lon: -73.9007 },
  { zip: "11237", market: "nyc", area: "Bushwick", lat: 40.7042, lon: -73.9211 },
  { zip: "11238", market: "nyc", area: "Prospect Heights", lat: 40.6795, lon: -73.9636 },
  { zip: "11239", market: "nyc", area: "Starrett City", lat: 40.6477, lon: -73.8791 },
  // Queens
  { zip: "11004", market: "nyc", area: "Glen Oaks", lat: 40.7462, lon: -73.7115 },
  { zip: "11005", market: "nyc", area: "Floral Park", lat: 40.7566, lon: -73.7142 },
  { zip: "11101", market: "nyc", area: "Long Island City", lat: 40.7440, lon: -73.9380 },
  { zip: "11102", market: "nyc", area: "Astoria", lat: 40.7729, lon: -73.9263 },
  { zip: "11103", market: "nyc", area: "Astoria", lat: 40.7626, lon: -73.9135 },
  { zip: "11104", market: "nyc", area: "Sunnyside", lat: 40.7446, lon: -73.9202 },
  { zip: "11105", market: "nyc", area: "Astoria / Ditmars", lat: 40.7790, lon: -73.9062 },
  { zip: "11106", market: "nyc", area: "Astoria / Ravenswood", lat: 40.7622, lon: -73.9315 },
  { zip: "11109", market: "nyc", area: "Hunters Point", lat: 40.7460, lon: -73.9575 },
  { zip: "11354", market: "nyc", area: "Flushing", lat: 40.7682, lon: -73.8274 },
  { zip: "11355", market: "nyc", area: "Flushing", lat: 40.7515, lon: -73.8210 },
  { zip: "11356", market: "nyc", area: "College Point", lat: 40.7849, lon: -73.8415 },
  { zip: "11357", market: "nyc", area: "Whitestone", lat: 40.7851, lon: -73.8100 },
  { zip: "11358", market: "nyc", area: "Auburndale", lat: 40.7605, lon: -73.7964 },
  { zip: "11360", market: "nyc", area: "Bayside", lat: 40.7803, lon: -73.7815 },
  { zip: "11361", market: "nyc", area: "Bayside", lat: 40.7642, lon: -73.7728 },
  { zip: "11362", market: "nyc", area: "Little Neck", lat: 40.7566, lon: -73.7353 },
  { zip: "11363", market: "nyc", area: "Douglaston", lat: 40.7723, lon: -73.7463 },
  { zip: "11364", market: "nyc", area: "Oakland Gardens", lat: 40.7453, lon: -73.7606 },
  { zip: "11365", market: "nyc", area: "Fresh Meadows", lat: 40.7396, lon: -73.7945 },
  { zip: "11366", market: "nyc", area: "Fresh Meadows", lat: 40.7282, lon: -73.7850 },
  { zip: "11367", market: "nyc", area: "Kew Gardens Hills", lat: 40.7301, lon: -73.8270 },
  { zip: "11368", market: "nyc", area: "Corona", lat: 40.7497, lon: -73.8530 },
  { zip: "11369", market: "nyc", area: "East Elmhurst", lat: 40.7634, lon: -73.8723 },
  { zip: "11370", market: "nyc", area: "Jackson Heights / East Elmhurst", lat: 40.7654, lon: -73.8932 },
  { zip: "11372", market: "nyc", area: "Jackson Heights", lat: 40.7517, lon: -73.8837 },
  { zip: "11373", market: "nyc", area: "Elmhurst", lat: 40.7388, lon: -73.8785 },
  { zip: "11374", market: "nyc", area: "Rego Park", lat: 40.7265, lon: -73.8615 },
  { zip: "11375", market: "nyc", area: "Forest Hills", lat: 40.7210, lon: -73.8466 },
  { zip: "11377", market: "nyc", area: "Woodside", lat: 40.7448, lon: -73.9052 },
  { zip: "11378", market: "nyc", area: "Maspeth", lat: 40.7247, lon: -73.9096 },
  { zip: "11379", market: "nyc", area: "Middle Village", lat: 40.7168, lon: -73.8796 },
  { zip: "11385", market: "nyc", area: "Ridgewood / Glendale", lat: 40.7006, lon: -73.8894 },
  { zip: "11411", market: "nyc", area: "Cambria Heights", lat: 40.6940, lon: -73.7362 },
  { zip: "11412", market: "nyc", area: "St. Albans", lat: 40.6981, lon: -73.7590 },
  { zip: "11413", market: "nyc", area: "Springfield Gardens", lat: 40.6712, lon: -73.7521 },
  { zip: "11414", market: "nyc", area: "Howard Beach", lat: 40.6576, lon: -73.8448 },
  { zip: "11415", market: "nyc", area: "Kew Gardens", lat: 40.7079, lon: -73.8283 },
  { zip: "11416", market: "nyc", area: "Ozone Park", lat: 40.6846, lon: -73.8496 },
  { zip: "11417", market: "nyc", area: "Ozone Park", lat: 40.6764, lon: -73.8445 },
  { zip: "11418", market: "nyc", area: "Richmond Hill", lat: 40.7002, lon: -73.8360 },
  { zip: "11419", market: "nyc", area: "South Richmond Hill", lat: 40.6886, lon: -73.8229 },
  { zip: "11420", market: "nyc", area: "South Ozone Park", lat: 40.6736, lon: -73.8178 },
  { zip: "11421", market: "nyc", area: "Woodhaven", lat: 40.6941, lon: -73.8586 },
  { zip: "11422", market: "nyc", area: "Rosedale", lat: 40.6601, lon: -73.7360 },
  { zip: "11423", market: "nyc", area: "Hollis", lat: 40.7156, lon: -73.7685 },
  { zip: "11426", market: "nyc", area: "Bellerose", lat: 40.7364, lon: -73.7224 },
  { zip: "11427", market: "nyc", area: "Queens Village", lat: 40.7309, lon: -73.7456 },
  { zip: "11428", market: "nyc", area: "Queens Village", lat: 40.7210, lon: -73.7423 },
  { zip: "11429", market: "nyc", area: "Queens Village", lat: 40.7098, lon: -73.7387 },
  { zip: "11432", market: "nyc", area: "Jamaica Estates", lat: 40.7154, lon: -73.7931 },
  { zip: "11433", market: "nyc", area: "Jamaica", lat: 40.6982, lon: -73.7869 },
  { zip: "11434", market: "nyc", area: "Jamaica / Rochdale", lat: 40.6779, lon: -73.7771 },
  { zip: "11435", market: "nyc", area: "Jamaica / Briarwood", lat: 40.7012, lon: -73.8096 },
  { zip: "11436", market: "nyc", area: "South Jamaica", lat: 40.6758, lon: -73.7967 },
  { zip: "11691", market: "nyc", area: "Far Rockaway", lat: 40.6013, lon: -73.7616 },
  { zip: "11692", market: "nyc", area: "Arverne", lat: 40.5942, lon: -73.7920 },
  { zip: "11693", market: "nyc", area: "Rockaway Beach / Broad Channel", lat: 40.5917, lon: -73.8097 },
  { zip: "11694", market: "nyc", area: "Rockaway Park / Belle Harbor", lat: 40.5783, lon: -73.8448 },
  { zip: "11697", market: "nyc", area: "Breezy Point", lat: 40.5527, lon: -73.9245 },
  // Staten Island
  { zip: "10301", market: "nyc", area: "St. George / Tompkinsville", lat: 40.6275, lon: -74.0944 },
  { zip: "10302", market: "nyc", area: "Port Richmond", lat: 40.6307, lon: -74.1377 },
  { zip: "10303", market: "nyc", area: "Mariners Harbor", lat: 40.6299, lon: -74.1741 },
  { zip: "10304", market: "nyc", area: "Stapleton / Clifton", lat: 40.6060, lon: -74.0935 },
  { zip: "10305", market: "nyc", area: "Rosebank / South Beach", lat: 40.5965, lon: -74.0758 },
  { zip: "10306", market: "nyc", area: "New Dorp / Midland Beach", lat: 40.5718, lon: -74.1260 },
  { zip: "10307", market: "nyc", area: "Tottenville", lat: 40.5088, lon: -74.2406 },
  { zip: "10308", market: "nyc", area: "Great Kills", lat: 40.5519, lon: -74.1476 },
  { zip: "10309", market: "nyc", area: "Charleston / Prince's Bay", lat: 40.5313, lon: -74.2199 },
  { zip: "10310", market: "nyc", area: "West Brighton", lat: 40.6326, lon: -74.1161 },
  { zip: "10312", market: "nyc", area: "Eltingville / Annadale", lat: 40.5445, lon: -74.1824 },
  { zip: "10314", market: "nyc", area: "Bulls Head / Travis", lat: 40.5993, lon: -74.1657 },
  // Jersey City
  { zip: "07302", market: "nyc", area: "Jersey City", lat: 40.7196, lon: -74.0460 },
  // San Francisco
  { zip: "94102", market: "sf", area: "Tenderloin / Hayes Valley", lat: 37.7795, lon: -122.4193 },
  { zip: "94103", market: "sf", area: "SoMa", lat: 37.7726, lon: -122.4110 },
  { zip: "94104", market: "sf", area: "Financial District", lat: 37.7914, lon: -122.4021 },
  { zip: "94105", market: "sf", area: "Rincon Hill / East Cut", lat: 37.7896, lon: -122.3931 },
  { zip: "94107", market: "sf", area: "Potrero Hill / Dogpatch", lat: 37.7621, lon: -122.3971 },
  { zip: "94108", market: "sf", area: "Chinatown / Union Square", lat: 37.7920, lon: -122.4086 },
  { zip: "94109", market: "sf", area: "Nob Hill / Polk Gulch", lat: 37.7929, lon: -122.4212 },
  { zip: "94110", market: "sf", area: "Mission / Bernal Heights", lat: 37.7485, lon: -122.4153 },
  { zip: "94111", market: "sf", area: "Embarcadero / Jackson Square", lat: 37.7994, lon: -122.3984 },
  { zip: "94112", market: "sf", area: "Excelsior / Ingleside", lat: 37.7204, lon: -122.4429 },
  { zip: "94114", market: "sf", area: "Castro / Noe Valley", lat: 37.7583, lon: -122.4351 },
  { zip: "94115", market: "sf", area: "Western Addition", lat: 37.7856, lon: -122.4370 },
  { zip: "94116", market: "sf", area: "Parkside / Outer Sunset", lat: 37.7454, lon: -122.4861 },
  { zip: "94117", market: "sf", area: "Haight-Ashbury", lat: 37.7700, lon: -122.4447 },
  { zip: "94118", market: "sf", area: "Inner Richmond", lat: 37.7812, lon: -122.4614 },
  { zip: "94121", market: "sf", area: "Outer Richmond", lat: 37.7768, lon: -122.4947 },
  { zip: "94122", market: "sf", area: "Inner Sunset", lat: 37.7590, lon: -122.4848 },
  { zip: "94123", market: "sf", area: "Marina", lat: 37.8003, lon: -122.4383 },
  { zip: "94124", market: "sf", area: "Bayview / Hunters Point", lat: 37.7289, lon: -122.3828 },
  { zip: "94127", market: "sf", area: "West Portal / St. Francis Wood", lat: 37.7360, lon: -122.4572 },
  { zip: "94129", market: "sf", area: "Presidio", lat: 37.7973, lon: -122.4645 },
  { zip: "94131", market: "sf", area: "Glen Park / Diamond Heights", lat: 37.7459, lon: -122.4415 },
  { zip: "94132", market: "sf", area: "Lake Merced / Stonestown", lat: 37.7222, lon: -122.4841 },
  { zip: "94133", market: "sf", area: "North Beach", lat: 37.8002, lon: -122.4097 },
  { zip: "94134", market: "sf", area: "Visitacion Valley", lat: 37.7210, lon: -122.4136 },
  { zip: "94158", market: "sf", area: "Mission Bay", lat: 37.7699, lon: -122.3870 },
  // East Bay
  { zip: "94606", market: "sf", area: "San Antonio, Oakland", lat: 37.7919, lon: -122.2453 },
  { zip: "94607", market: "sf", area: "West Oakland / Jack London", lat: 37.8072, lon: -122.3015 },
  { zip: "94609", market: "sf", area: "Temescal, Oakland", lat: 37.8344, lon: -122.2644 },
  { zip: "94610", market: "sf", area: "Grand Lake, Oakland", lat: 37.8124, lon: -122.2405 },
  { zip: "94611", market: "sf", area: "Piedmont Ave / Montclair, Oakland", lat: 37.8293, lon: -122.2035 },
  { zip: "94612", market: "sf", area: "Downtown Oakland", lat: 37.8102, lon: -122.2697 },
  { zip: "94618", market: "sf", area: "Rockridge, Oakland", lat: 37.8448, lon: -122.2386 },
  { zip: "94501", market: "sf", area: "Alameda", lat: 37.7738, lon: -122.2781 },
  { zip: "94702", market: "sf", area: "West Berkeley", lat: 37.8658, lon: -122.2863 },
  { zip: "94703", market: "sf", area: "South Berkeley", lat: 37.8639, lon: -122.2756 },
  { zip: "94704", market: "sf", area: "Berkeley", lat: 37.8664, lon: -122.2573 },
  { zip: "94705", market: "sf", area: "Claremont / Elmwood, Berkeley", lat: 37.8652, lon: -122.2382 },
  { zip: "94709", market: "sf", area: "North Berkeley", lat: 37.8792, lon: -122.2668 },
  // Peninsula
  { zip: "94401", market: "sf", area: "San Mateo", lat: 37.5769, lon: -122.3169 },
  { zip: "94063", market: "sf", area: "Redwood City", lat: 37.4933, lon: -122.1956 },
  { zip: "94301", market: "sf", area: "Palo Alto", lat: 37.4442, lon: -122.1500 },
  { zip: "94040", market: "sf", area: "Mountain View", lat: 37.3800, lon: -122.0850 },
  // Los Angeles
  { zip: "90001", market: "la", area: "Florence-Firestone", lat: 33.9740, lon: -118.2495 },
  { zip: "90002", market: "la", area: "Watts", lat: 33.9491, lon: -118.2467 },
  { zip: "90003", market: "la", area: "South Los Angeles", lat: 33.9641, lon: -118.2728 },
  { zip: "90004", market: "la", area: "Larchmont / Koreatown", lat: 34.0763, lon: -118.3089 },
  { zip: "90005", market: "la", area: "Koreatown", lat: 34.0592, lon: -118.3069 },
  { zip: "90006", market: "la", area: "Pico-Union / Koreatown", lat: 34.0480, lon: -118.2942 },
  { zip: "90007", market: "la", area: "University Park / USC", lat: 34.0281, lon: -118.2848 },
  { zip: "90008", market: "la", area: "Baldwin Hills / Leimert Park", lat: 34.0096, lon: -118.3467 },
  { zip: "90010", market: "la", area: "Mid-Wilshire", lat: 34.0621, lon: -118.3159 },
  { zip: "90011", market: "la", area: "South Central", lat: 34.0071, lon: -118.2587 },
  { zip: "90012", market: "la", area: "Chinatown / Civic Center", lat: 34.0614, lon: -118.2386 },
  { zip: "90013", market: "la", area: "Downtown LA", lat: 34.0448, lon: -118.2418 },
  { zip: "90014", market: "la", area: "Downtown LA / Historic Core", lat: 34.0431, lon: -118.2517 },
  { zip: "90015", market: "la", area: "South Park / Fashion District", lat: 34.0394, lon: -118.2663 },
  { zip: "90016", market: "la", area: "West Adams / Jefferson Park", lat: 34.0283, lon: -118.3543 },
  { zip: "90017", market: "la", area: "Westlake South / City West", lat: 34.0529, lon: -118.2643 },
  { zip: "90018", market: "la", area: "Jefferson Park / Arlington Heights", lat: 34.0289, lon: -118.3172 },
  { zip: "90019", market: "la", area: "Mid-City / Country Club Park", lat: 34.0498, lon: -118.3385 },
  { zip: "90020", market: "la", area: "Hancock Park / Koreatown", lat: 34.0664, lon: -118.3099 },
  { zip: "90021", market: "la", area: "Arts District", lat: 34.0290, lon: -118.2379 },
  { zip: "90023", market: "la", area: "Boyle Heights South", lat: 34.0225, lon: -118.1996 },
  { zip: "90024", market: "la", area: "Westwood", lat: 34.0657, lon: -118.4350 },
  { zip: "90025", market: "la", area: "West Los Angeles / Sawtelle", lat: 34.0454, lon: -118.4459 },
  { zip: "90026", market: "la", area: "Echo Park", lat: 34.0766, lon: -118.2646 },
  { zip: "90027", market: "la", area: "Los Feliz", lat: 34.1040, lon: -118.2930 },
  { zip: "90028", market: "la", area: "Hollywood", lat: 34.0996, lon: -118.3270 },
  { zip: "90029", market: "la", area: "East Hollywood", lat: 34.0898, lon: -118.2947 },
  { zip: "90031", market: "la", area: "Lincoln Heights", lat: 34.0842, lon: -118.2086 },
  { zip: "90032", market: "la", area: "El Sereno", lat: 34.0783, lon: -118.1858 },
  { zip: "90033", market: "la", area: "Boyle Heights", lat: 34.0504, lon: -118.2120 },
  { zip: "90034", market: "la", area: "Palms", lat: 34.0306, lon: -118.3995 },
  { zip: "90035", market: "la", area: "Pico-Robertson", lat: 34.0518, lon: -118.3836 },
  { zip: "90036", market: "la", area: "Mid-Wilshire / Fairfax", lat: 34.0700, lon: -118.3490 },
  { zip: "90037", market: "la", area: "Vermont Square", lat: 34.0027, lon: -118.2875 },
  { zip: "90038", market: "la", area: "Hollywood / Melrose", lat: 34.0885, lon: -118.3255 },
  { zip: "90039", market: "la", area: "Silver Lake / Atwater", lat: 34.1117, lon: -118.2610 },
  { zip: "90041", market: "la", area: "Eagle Rock", lat: 34.1374, lon: -118.2076 },
  { zip: "90042", market: "la", area: "Highland Park", lat: 34.1148, lon: -118.1918 },
  { zip: "90043", market: "la", area: "Hyde Park / View Park", lat: 33.9885, lon: -118.3364 },
  { zip: "90044", market: "la", area: "Vermont Knolls / Athens", lat: 33.9527, lon: -118.2919 },
  { zip: "90045", market: "la", area: "Westchester", lat: 33.9424, lon: -118.4161 },
  { zip: "90046", market: "la", area: "West Hollywood", lat: 34.1075, lon: -118.3650 },
  { zip: "90047", market: "la", area: "Gramercy Park / Hyde Park", lat: 33.9536, lon: -118.3084 },
  { zip: "90048", market: "la", area: "Beverly Grove", lat: 34.0729, lon: -118.3727 },
  { zip: "90049", market: "la", area: "Brentwood", lat: 34.0925, lon: -118.4911 },
  { zip: "90056", market: "la", area: "Ladera Heights", lat: 33.9880, lon: -118.3704 },
  { zip: "90057", market: "la", area: "Westlake", lat: 34.0617, lon: -118.2768 },
  { zip: "90059", market: "la", area: "Watts / Willowbrook", lat: 33.9263, lon: -118.2499 },
  { zip: "90061", market: "la", area: "South Los Angeles / Harbor Gateway", lat: 33.9213, lon: -118.2742 },
  { zip: "90062", market: "la", area: "Exposition Park / Manchester Square", lat: 34.0036, lon: -118.3088 },
  { zip: "90063", market: "la", area: "City Terrace / East LA", lat: 34.0451, lon: -118.1859 },
  { zip: "90064", market: "la", area: "Rancho Park / Cheviot Hills", lat: 34.0373, lon: -118.4236 },
  { zip: "90065", market: "la", area: "Glassell Park / Mount Washington", lat: 34.1096, lon: -118.2287 },
  { zip: "90066", market: "la", area: "Mar Vista", lat: 34.0030, lon: -118.4300 },
  { zip: "90067", market: "la", area: "Century City", lat: 34.0576, lon: -118.4140 },
  { zip: "90068", market: "la", area: "Hollywood Hills", lat: 34.1298, lon: -118.3310 },
  { zip: "90069", market: "la", area: "West Hollywood / Sunset Strip", lat: 34.0938, lon: -118.3817 },
  { zip: "90071", market: "la", area: "Bunker Hill", lat: 34.0529, lon: -118.2549 },
  { zip: "90077", market: "la", area: "Bel Air", lat: 34.1080, lon: -118.4570 },
  { zip: "90094", market: "la", area: "Playa Vista", lat: 33.9754, lon: -118.4170 },
  // Westside
  { zip: "90210", market: "la", area: "Beverly Hills", lat: 34.1005, lon: -118.4146 },
  { zip: "90211", market: "la", area: "Beverly Hills South", lat: 34.0650, lon: -118.3830 },
  { zip: "90212", market: "la", area: "Beverly Hills", lat: 34.0622, lon: -118.4020 },
  { zip: "90230", market: "la", area: "Culver City", lat: 33.9979, lon: -118.3936 },
  { zip: "90232", market: "la", area: "Culver City / Palms", lat: 34.0193, lon: -118.3919 },
  { zip: "90272", market: "la", area: "Pacific Palisades", lat: 34.0926, lon: -118.5344 },
  { zip: "90291", market: "la", area: "Venice", lat: 33.9930, lon: -118.4630 },
  { zip: "90292", market: "la", area: "Marina del Rey", lat: 33.9764, lon: -118.4509 },
  { zip: "90293", market: "la", area: "Playa del Rey", lat: 33.9473, lon: -118.4398 },
  { zip: "90401", market: "la", area: "Santa Monica", lat: 34.0160, lon: -118.4930 },
  { zip: "90402", market: "la", area: "Santa Monica North", lat: 34.0347, lon: -118.5040 },
  { zip: "90403", market: "la", area: "Santa Monica Wilshire", lat: 34.0308, lon: -118.4921 },
  { zip: "90404", market: "la", area: "Santa Monica Pico", lat: 34.0266, lon: -118.4736 },
  { zip: "90405", market: "la", area: "Santa Monica / Ocean Park", lat: 34.0113, lon: -118.4698 },
  // South Bay
  { zip: "90245", market: "la", area: "El Segundo", lat: 33.9171, lon: -118.4043 },
  { zip: "90254", market: "la", area: "Hermosa Beach", lat: 33.8643, lon: -118.3993 },
  { zip: "90266", market: "la", area: "Manhattan Beach", lat: 33.8892, lon: -118.4021 },
  { zip: "90277", market: "la", area: "Redondo Beach", lat: 33.8300, lon: -118.3871 },
  { zip: "90301", market: "la", area: "Inglewood", lat: 33.9565, lon: -118.3587 },
  { zip: "90302", market: "la", area: "Inglewood North", lat: 33.9753, lon: -118.3553 },
  { zip: "90501", market: "la", area: "Torrance", lat: 33.8337, lon: -118.3140 },
  // San Gabriel Valley
  { zip: "91101", market: "la", area: "Pasadena", lat: 34.1468, lon: -118.1390 },
  { zip: "91103", market: "la", area: "Pasadena / Linda Vista", lat: 34.1695, lon: -118.1649 },
  { zip: "91104", market: "la", area: "Pasadena East", lat: 34.1654, lon: -118.1238 },
  { zip: "91105", market: "la", area: "Pasadena South", lat: 34.1395, lon: -118.1666 },
  { zip: "91106", market: "la", area: "Pasadena / Playhouse", lat: 34.1394, lon: -118.1287 },
  { zip: "91107", market: "la", area: "East Pasadena", lat: 34.1555, lon: -118.0862 },
  { zip: "91030", market: "la", area: "South Pasadena", lat: 34.1090, lon: -118.1566 },
  { zip: "91801", market: "la", area: "Alhambra", lat: 34.0907, lon: -118.1275 },
  // Glendale / Burbank
  { zip: "91201", market: "la", area: "Glendale / Pelanconi", lat: 34.1705, lon: -118.2895 },
  { zip: "91202", market: "la", area: "Glendale North", lat: 34.1684, lon: -118.2678 },
  { zip: "91203", market: "la", area: "Downtown Glendale", lat: 34.1533, lon: -118.2630 },
  { zip: "91204", market: "la", area: "Glendale South", lat: 34.1362, lon: -118.2609 },
  { zip: "91205", market: "la", area: "Glendale South East", lat: 34.1366, lon: -118.2458 },
  { zip: "91206", market: "la", area: "Glendale East", lat: 34.1604, lon: -118.2138 },
  { zip: "91502", market: "la", area: "Downtown Burbank", lat: 34.1768, lon: -118.3093 },
  { zip: "91505", market: "la", area: "Burbank / Media District", lat: 34.1739, lon: -118.3469 },
  { zip: "91506", market: "la", area: "Burbank Rancho", lat: 34.1712, lon: -118.3239 },
  // San Fernando Valley
  { zip: "91601", market: "la", area: "North Hollywood", lat: 34.1680, lon: -118.3720 },
  { zip: "91602", market: "la", area: "Toluca Lake / NoHo", lat: 34.1508, lon: -118.3682 },
  { zip: "91604", market: "la", area: "Studio City", lat: 34.1408, lon: -118.3929 },
  { zip: "91605", market: "la", area: "North Hollywood North", lat: 34.2073, lon: -118.4010 },
  { zip: "91606", market: "la", area: "Valley Glen", lat: 34.1858, lon: -118.3883 },
  { zip: "91607", market: "la", area: "Valley Village", lat: 34.1658, lon: -118.3998 },
  { zip: "91423", market: "la", area: "Sherman Oaks", lat: 34.1486, lon: -118.4333 },
  { zip: "91403", market: "la", area: "Sherman Oaks South", lat: 34.1471, lon: -118.4634 },
  { zip: "91436", market: "la", area: "Encino", lat: 34.1496, lon: -118.4897 },
  { zip: "91316", market: "la", area: "Encino West", lat: 34.1602, lon: -118.5155 },
  { zip: "91356", market: "la", area: "Tarzana", lat: 34.1551, lon: -118.5476 },
  { zip: "91401", market: "la", area: "Van Nuys", lat: 34.1785, lon: -118.4318 },
  { zip: "91405", market: "la", area: "Van Nuys North", lat: 34.1998, lon: -118.4476 },
  { zip: "91406", market: "la", area: "Lake Balboa", lat: 34.1975, lon: -118.4890 },
  { zip: "91411", market: "la", area: "Van Nuys / Sherman Oaks", lat: 34.1785, lon: -118.4592 },
  { zip: "91367", market: "la", area: "Woodland Hills", lat: 34.1773, lon: -118.6157 },
  { zip: "91324", market: "la", area: "Northridge", lat: 34.2382, lon: -118.5503 },
  // Long Beach
  { zip: "90802", market: "la", area: "Long Beach", lat: 33.7660, lon: -118.1930 },
  { zip: "90803", market: "la", area: "Belmont Shore / Naples", lat: 33.7567, lon: -118.1311 },
  { zip: "90804", market: "la", area: "Long Beach / Alamitos Beach", lat: 33.7817, lon: -118.1484 },
  { zip: "90806", market: "la", area: "Long Beach / Wrigley", lat: 33.8054, lon: -118.1877 },
  { zip: "90813", market: "la", area: "Long Beach / Westside", lat: 33.7823, lon: -118.1968 },
  { zip: "90814", market: "la", area: "Long Beach / Bluff Heights", lat: 33.7716, lon: -118.1436 },
];

/**
 * The home zips the slop world samples personas from (the original 53-zip table, in its original
 * order). Kept fixed so slop worlds, run ids and goldens stay the same as the table grows.
 */
export const SIM_HOME_ZIPS: readonly string[] = [
  "94102", "94103", "94107", "94109", "94110", "94114", "94115", "94117", "94118", "94122", "94123", "94133", "94612", "94610", "94704", "94301", "94040",
  "10001", "10002", "10003", "10011", "10014", "10016", "10023", "10025", "10027", "10028", "11201", "11211", "11215", "11216", "11222", "11238", "11101", "11375", "07302",
  "90004", "90012", "90013", "90026", "90027", "90028", "90034", "90036", "90039", "90042", "90046", "90066", "90291", "90401", "91101", "91601", "90802",
];

const BY_ZIP = new Map(ZIPS.map(z => [z.zip, z]));
/** The 5-digit zip in a member's text ("10025", "10025-1234", "zip 10025"); undefined if none. */
export function normalizeZip(text: string | undefined): string | undefined {
  return text?.match(/(?<!\d)(\d{5})(?:-\d{4})?(?!\d)/)?.[1];
}
/** The centroid of a known zip (ZIP+4 and surrounding text are accepted); undefined for an unknown zip. */
export const zipCentroid = (zip: string): ZipCentroid | undefined => BY_ZIP.get(normalizeZip(zip) ?? zip);
/** True if the zip is in the table. */
export const isKnownZip = (zip: string | undefined): boolean => !!zip && !!zipCentroid(zip);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/**
 * The zip of a neighborhood a member named ("I'm in Astoria", "park slope"), optionally within one
 * market: an exact match on one part of an area label first ("Astoria", "Ditmars"), then a label
 * containing the text. The first zip in table order wins. Undefined when nothing matches.
 */
export function zipForArea(text: string | undefined, market?: City): ZipCentroid | undefined {
  const t = text ? norm(text) : "";
  if (t.length < 3) return undefined;
  const pool = market ? ZIPS.filter(z => z.market === market) : ZIPS;
  const parts = (z: ZipCentroid) => z.area.split(/\s*[\/,]\s*/).map(norm);
  return pool.find(z => parts(z).includes(t)) ?? pool.find(z => parts(z).some(p => p.length >= 3 && (t.includes(p) || p.includes(t))));
}

/**
 * Where a visitor to a market is assumed to meet (downtown core), for multi-city members and travelers
 * whose own zip is in another market. Same convention as the slop world.
 */
export const MARKET_ANCHOR_ZIP: Record<City, string> = { sf: "94103", nyc: "10003", la: "90026" };

/** Coarse cell size in degrees (about 1.1 km north-south): the only location the matcher computes on. */
export const CELL_DEG = 0.01;
export interface Cell { id: string; lat: number; lon: number }
/** Snap a zip centroid to its coarse cell (cell centre). Undefined for an unknown zip. */
export function cellOfZip(zip: string): Cell | undefined {
  const z = zipCentroid(zip);
  if (!z) return undefined;
  const i = Math.floor(z.lat / CELL_DEG), j = Math.floor(z.lon / CELL_DEG);
  return { id: `cell:${i}:${j}`, lat: (i + 0.5) * CELL_DEG, lon: (j + 0.5) * CELL_DEG };
}
/** Worst-case error of a cell-to-cell distance against the centroid distance, in miles (two half-diagonals). */
export const CELL_ERROR_MILES = 2 * 0.5 * Math.hypot(CELL_DEG * 69.0, CELL_DEG * 69.0 * Math.cos((34 * Math.PI) / 180));

/** Great-circle miles between two cells (Infinity when either is unknown). */
export function cellMiles(a: Cell | undefined, b: Cell | undefined): number {
  if (!a || !b) return Infinity;
  if (a.id === b.id) return 0;
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The only distance a member is ever shown: a band, never a number of miles or a coordinate. */
export type DistanceBand = "under 2 mi" | "2-5 mi" | "5-10 mi" | "10-25 mi" | "25+ mi";
export function distanceBand(miles: number): DistanceBand {
  return miles < 2 ? "under 2 mi" : miles < 5 ? "2-5 mi" : miles < 10 ? "5-10 mi" : miles < 25 ? "10-25 mi" : "25+ mi";
}
