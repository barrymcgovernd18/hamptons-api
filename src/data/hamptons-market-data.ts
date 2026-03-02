/**
 * Hamptons Market Intelligence Data
 * 
 * Complete location classification system extracted from Barry's knowledge.
 * Waterfront types, SOH/NOH, street premiums, village comp regions.
 * This data is used at runtime to classify any address.
 */

// =============================================================================
// LOCATION TYPES & TIERS
// =============================================================================

export type LocationType = 
  | "tier1_oceanfront"
  | "soh_waterfront"
  | "tier2_prime_soh"
  | "tier3_soh"
  | "tier4_noh_waterfront"
  | "noh_standard"
  | "noh_village"
  | "northwest_woods"
  | "springs"
  | "standard";

export type LocationTier = "Trophy" | "Prime" | "Premium" | "Core" | "Entry";
export type MarketTier = "trophy" | "upper" | "core" | "entry";
export type WaterfrontType = "ocean" | "bay" | "pond" | "creek" | "none";

export interface LocationClassification {
  locationType: LocationType;
  locationTier: LocationTier;
  isSouthOfHighway: boolean;
  hasWaterfront: boolean;
  waterfrontType: WaterfrontType;
  isPrimeRoad: boolean;
  streetPremium: number;
}

// =============================================================================
// TIER 1 — OCEANFRONT STREETS
// =============================================================================

export const TIER1_OCEANFRONT: Record<string, string[]> = {
  "southampton": [
    "meadow lane", "gin lane", "sandown court",
  ],
  "southampton village": [
    "meadow lane", "gin lane", "sandown court",
  ],
  "water mill": [
    "murray lane", "squabble lane", "barrens road", "fowler way",
  ],
  "bridgehampton": [
    "dune road", "surfside drive", "mid ocean drive",
  ],
  "sagaponack": [
    "gibson beach road", "crestview lane", "fairfield pond road",
    "daniels lane", "potato lane", "town line road", "sandune court",
    "sagg main street",
  ],
  "wainscott": [
    "beach lane", "association road",
  ],
  "east hampton": [
    "west end avenue", "west end road", "west dune road",
    "windmill lane", "spaeth lane",
    "lily pond lane", "further lane",
  ],
  "east hampton village": [
    "west end avenue", "west end road", "west dune road",
    "windmill lane", "spaeth lane",
    "lily pond lane", "further lane",
  ],
  "amagansett": [
    "amagansett west end lane", "bluff road", "marine boulevard",
  ],
  "montauk": [
    "old montauk highway", "surfside avenue", "seaside avenue", "deforest road",
  ],
  "westhampton": [
    "dune road", "marine boulevard",
  ],
  "westhampton beach": [
    "dune road", "marine boulevard",
  ],
};

// NOTE: Lily Pond Lane and Further Lane have BOTH oceanfront (south side) and
// non-oceanfront (north side) properties. They are NOT Tier 1 by default.
// Individual addresses should be checked against verified oceanfront sales.
export const DUAL_SIDE_STREETS: Record<string, string[]> = {
  "east hampton": ["lily pond lane", "further lane"],
};

// Verified oceanfront address ranges on dual-side streets
export const VERIFIED_OCEANFRONT_ADDRESSES: Record<string, string[]> = {
  "east hampton": [
    "further lane", "lily pond lane", "two mile hollow road",
  ],
  "southampton": [
    // Meadow Lane 1050-2020 range, Murray Lane/Place, Fowler Street, Halsey Neck Lane
    "meadow lane", "murray lane", "murray place", "fowler street",
    "halsey neck lane", "gin lane",
  ],
  "bridgehampton": [
    // Surfside Drive 55-263, Dune Road 125-313, Mid Ocean Drive, Pointe Mecox Lane
    "surfside drive", "dune road", "mid ocean drive", "pointe mecox lane",
  ],
  "wainscott": ["beach lane"],
  "sagaponack": [
    "town line road", "potato road", "daniels lane", "sagg main street", "sandune court",
  ],
  "water mill": [
    "flying point road", "morrison lane", "fowler street", "jule pond drive",
  ],
  "amagansett": ["marine boulevard"],
  "montauk": [
    "old montauk highway", "deforest road", "surfside avenue", "seaside avenue",
  ],
};

// =============================================================================
// SOH WATERFRONT STREETS (Bay/Pond/Cove frontage)
// =============================================================================

export const SOH_WATERFRONT_STREETS: Record<string, string[]> = {
  "water mill": [
    "georgian lane", "georgian", "cobb isle road", "cobb isle",
    "bay lane", "mecox bay lane", "mecox bay", "burnetts cove",
    "burnetts cove road", "kellis pond lane", "kellis pond",
    "jule pond drive", "jule pond", "hayground cove road", "hayground cove",
    "mill creek close", "mill creek", "olivers cove lane", "olivers cove",
    "calf creek", "calf creek court", "morrison lane", "morrison",
    "holly lane", "wild goose lane", "wild goose", "osprey way",
    "swans neck lane", "mecox field lane", "pointe mecox lane", "pointe mecox",
  ],
  "southampton": [
    "meadow lane", "gin lane", "little plains road", "toylsome lane",
    "wickapogue road",
  ],
  "southampton village": [
    "meadow lane", "gin lane", "little plains road", "toylsome lane",
    "wickapogue road",
  ],
  "east hampton": [
    "georgica road", "georgica close", "georgica pond",
    "hook pond lane", "egypt lane",
  ],
  "sagaponack": [
    "fairfield pond", "fairfield pond road", "peters pond lane",
    "peters pond", "sagg pond",
  ],
  "bridgehampton": [
    "kellis pond", "scuttlehole road",
  ],
};

// =============================================================================
// TIER 4 — NOH WATERFRONT STREETS
// =============================================================================

export const TIER4_NOH_WATERFRONT: Record<string, string[]> = {
  "sag harbor": [
    "bay street", "west water street", "marine park", "long wharf",
    "noyack road", "north haven road", "madison street", "main street",
    "union street", "division street", "glover street", "shaw road",
    "forest road", "bay view court", "cedar avenue", "bluff point lane",
    "on the bluff", "ferry road", "harbor drive", "mashomuck drive",
    "redwood road", "sunset beach road", "bay view drive east",
    "peconic avenue", "morris cove lane", "bay avenue", "lily pond drive",
    "noyack harbor road", "crescent street",
  ],
  "east hampton": [
    "three mile harbor road", "hands creek road", "gerard drive",
  ],
  "southampton": [
    "north sea road", "noyack road", "little peconic bay road",
  ],
  "shelter island": [
    "shore road", "ram island road", "winthrop road",
  ],
  "shelter island heights": [
    "shore road", "ram island road", "winthrop road",
  ],
};

// =============================================================================
// TIER 2 — PRIME SOH STREETS
// =============================================================================

export const TIER2_PRIME_SOH: Record<string, string[]> = {
  "southampton": [
    "captains neck lane", "captain's neck lane", "baldy neck lane",
    "coopers neck lane", "cooper's neck lane", "first neck lane",
    "great plains road", "ox pasture road", "lee avenue",
    "barnhart street", "south hill street", "anns lane", "ann's lane",
    "raymonds lane", "raymond's lane", "oldfield lane", "adams lane",
    "leos lane", "leo's lane", "south main street", "foster crossing",
    "little plains road", "toylsome lane", "oast lane",
    "hunting street", "christopher street", "wyandanch lane",
    "oldtown road", "wyckoff park road", "duck pond lane",
    "pheasant lane", "barrons lane", "dule pond drive",
    "cobb road", "halsey neck lane",
  ],
  "southampton village": [
    "captains neck lane", "captain's neck lane", "baldy neck lane",
    "coopers neck lane", "cooper's neck lane", "first neck lane",
    "great plains road", "ox pasture road", "lee avenue",
    "barnhart street", "south hill street", "anns lane", "ann's lane",
    "raymonds lane", "raymond's lane", "oldfield lane", "adams lane",
    "leos lane", "leo's lane", "south main street", "foster crossing",
    "little plains road", "toylsome lane", "oast lane",
    "hunting street", "christopher street", "wyandanch lane",
    "oldtown road", "wyckoff park road", "duck pond lane",
    "pheasant lane", "barrons lane", "dule pond drive",
    "cobb road", "halsey neck lane",
  ],
  "water mill": [
    "posie lane", "rose hill road", "mecox road", "jones lane",
    "ocean road", "pauls lane", "paul's lane", "new light lane",
    "church lane", "sagaponack road", "flying point road",
    "cobb road", "head of pond road", "deerfield road",
  ],
  "bridgehampton": [
    "posie lane", "rose hill road", "mecox road", "jones lane",
    "ocean road", "pauls lane", "paul's lane", "new light lane",
    "church lane", "sagaponack road", "jobs lane", "mitchell lane",
    "lumber lane",
  ],
  "sagaponack": [
    "parsonage lane", "hedges lane", "fairfield pond road",
    "two rod highway", "westwood road", "sagg road",
    "peters pond lane", "narrow lane",
  ],
  "wainscott": [
    "wainscott hollow road", "sayers path", "roxbury lane",
    "wainscott main road", "wainscott stone road",
    "wainscott main street", "merrywood drive", "goose creek road",
    "town line road", "georgica association road",
  ],
  "east hampton": [
    "lily pond lane", "further lane", "shore road", "jericho lane",
    "private lane", "georgica close road", "georgica close",
    "briar patch road", "cutting hill lane", "the crossways",
    "dunemere lane", "dune mere lane", "pond view lane",
    "davids lane", "david's lane", "hunting lane", "huntting lane",
    "heather lane", "egypt lane", "lees lane", "lee's lane",
    "lee avenue", "cedar street", "hedges lane", "cove hollow road",
    "apaquogue road", "two mile hollow road", "georgica road",
    "ocean avenue", "middle lane", "hither lane",
    "amys lane", "amy's lane", "baiting hollow road",
    "east hollow road", "skimhampton road", "ruxton road",
    "terbell lane", "cross highway", "lockwood lane",
    "pondview lane", "darby lane", "foxcroft lane",
    "buckskill road", "the circle", "cottage avenue",
    "st marys lane", "maidstone lane", "woods lane",
    "jericho road", "sarahs way", "pudding hill lane",
    "atlantic avenue", "pantigo road", "marina lane",
    "cross road", "fieldview lane", "jefferys lane",
    "egypt close", "jones creek lane", "jones cove road",
    "north bay lane", "drew lane", "eileens path",
  ],
};

// =============================================================================
// SOH STREETS BY HAMLET (complete lookup)
// =============================================================================

export const SOH_STREETS: Record<string, string[]> = {
  "east hampton": [
    "amys lane", "amy's lane", "apaquogue road", "baiting hollow road",
    "briar patch road", "buckskill road", "the circle", "cottage avenue",
    "cove hollow road", "cross highway", "cross road", "crossways",
    "the crossways", "darby lane", "davids lane", "david's lane",
    "drew lane", "dunemere lane", "dune mere lane", "east hollow road",
    "egypt close", "egypt lane", "eileens path", "eileen's path",
    "fieldview lane", "foxcroft lane", "further lane",
    "georgica close road", "georgica close", "georgica road",
    "hedges lane", "hither lane", "hook pond", "huntting lane",
    "hunting lane", "jefferys lane", "jericho lane", "jericho road",
    "jones creek lane", "jones cove road", "judson lane",
    "lee avenue", "lily pond lane", "lockwood lane",
    "maidstone lane", "marina lane", "middle lane",
    "montauk highway", "north bay lane", "ocean avenue",
    "pantigo road", "pondview lane", "pond view lane",
    "pudding hill lane", "ruxton road", "sarahs way", "sayres path",
    "skimhampton road", "st marys lane", "terbell lane",
    "two mile hollow road", "tyson lane", "woods lane",
    "west end road", "west end avenue", "west dune road",
  ],
  "bridgehampton": [
    "audubon avenue", "bridge lane", "bridgefield road",
    "bull head lane", "church lane", "dune road",
    "halsey lane", "highland terrace", "hildreth lane",
    "jobs lane", "kellis pond lane", "lockwood avenue",
    "matthews lane", "mecox fields lane", "mecox road",
    "montauk highway", "newlight lane", "new light lane", "oak street",
    "ocean road", "pauls lane", "paul's lane", "pine street",
    "pointe mecox lane", "quimby lane", "rose way",
    "sagaponack road", "sandpiper lane", "school street",
    "silver lane", "surfside drive", "trelawney road",
    "west pond drive",
  ],
  "water mill": [
    "bay lane", "brennans moor", "burnetts cove road",
    "calf creek court", "cobb hill lane", "cobb isle road",
    "cobb road", "crescent avenue", "davids lane", "david's lane",
    "flying point road", "fordune court", "fordune drive",
    "georgian lane", "halsey lane", "hayground cove road",
    "holly lane", "jule pond drive", "kellis pond lane",
    "lawrence court", "little cobb road", "luther drive",
    "mecox bay lane", "mecox field lane", "mecox road",
    "mill creek close", "mill pond lane", "montauk highway",
    "montrose lane", "morrison lane", "newlight lane", "new light lane",
    "olivers cove lane", "osprey way", "pauls lane", "paul's lane",
    "pointe mecox lane", "rose hill road", "summerfield lane",
    "swans neck lane", "swan creek court", "wheaton way",
    "wild goose lane", "westminster road",
  ],
  "sagaponack": [
    "bridge lane", "crestview lane", "daniels lane",
    "davids court", "east woods path", "ericas lane", "erica's lane",
    "fairfield pond lane", "farm court", "farmview drive",
    "glenwood lane", "hedges lane", "herb court",
    "holden court", "jared lane", "narrow lane east",
    "old barn lane", "old farm road", "parsonage lane",
    "parsonage pond road", "poxabogue lane",
    "sagaponack main street", "sagaponack road",
    "sagg main street", "sagg pond court", "sagg road",
    "sandune court", "seascape lane", "town line road",
    "wainscott harbor road", "wilkes lane",
  ],
  "wainscott": [
    "beach lane", "elishas path", "elisha's path", "glen oak court",
    "merriwood drive", "merrywood drive", "osborn farm lane",
    "oakwood court", "roxbury lane", "sayres path", "sayers path",
    "town line road", "two rod highway",
    "wainscott hollow road", "wainscott main street",
    "wainscott northwest road", "wainscott stone road",
    "westwood road", "windsor lane",
  ],
  "southampton": [
    "meadow lane", "gin lane", "first neck lane", "halsey neck lane",
    "coopers neck lane", "cooper's neck lane", "captains neck lane",
    "captain's neck lane", "ox pasture road", "great plains road",
    "little plains road", "toylsome lane", "wickapogue road",
    "lee avenue", "south main street", "south hill street",
    "barnhart street", "anns lane", "ann's lane", "raymonds lane",
    "raymond's lane", "oldfield lane", "adams lane", "leos lane",
    "leo's lane", "foster crossing", "oast lane", "hunting street",
    "christopher street", "wyandanch lane", "oldtown road",
    "wyckoff park road", "duck pond lane", "pheasant lane",
    "barrons lane", "dule pond drive", "cobb road",
    "fordune drive", "fordune court", "summerfield lane",
    "sandown court",
  ],
  "southampton village": [
    "meadow lane", "gin lane", "first neck lane", "halsey neck lane",
    "coopers neck lane", "cooper's neck lane", "captains neck lane",
    "captain's neck lane", "ox pasture road", "great plains road",
    "little plains road", "toylsome lane", "wickapogue road",
    "lee avenue", "south main street", "south hill street",
  ],
};

// General SOH keyword detection (fallback when street not in lists)
export const SOH_KEYWORDS = [
  "south", "ocean", "beach", "dune", "surfside",
];

// =============================================================================
// STREET PREMIUMS (multipliers on top of base value)
// =============================================================================

export const STREET_PREMIUMS: Record<string, Record<string, number>> = {
  "southampton": {
    "gin lane": 1.35, "meadow lane": 1.30, "ox pasture road": 1.15,
    "first neck lane": 1.12, "coopers neck lane": 1.12,
    "cooper's neck lane": 1.12, "captains neck lane": 1.12,
    "captain's neck lane": 1.12, "halsey neck lane": 1.10,
  },
  "southampton village": {
    "gin lane": 1.35, "meadow lane": 1.30, "ox pasture road": 1.15,
    "first neck lane": 1.12, "coopers neck lane": 1.12,
    "cooper's neck lane": 1.12, "captains neck lane": 1.12,
    "captain's neck lane": 1.12, "halsey neck lane": 1.10,
  },
  "east hampton": {
    "lily pond lane": 1.30, "further lane": 1.25,
    "west end road": 1.20, "georgica close": 1.15,
  },
  "sagaponack": {
    "daniels lane": 1.20, "parsonage lane": 1.15,
  },
  "water mill": {
    "flying point road": 1.15, "mecox road": 1.10,
  },
  "bridgehampton": {
    "ocean road": 1.15, "jobs lane": 1.10,
  },
};

// =============================================================================
// WATERFRONT PREMIUMS
// =============================================================================

export const WATERFRONT_PREMIUMS: Record<WaterfrontType, number> = {
  ocean: 1.50,
  bay: 1.20,
  pond: 1.10,
  creek: 1.05,
  none: 1.00,
};

// =============================================================================
// VILLAGE COMP REGIONS
// =============================================================================

/** Oceanfront comp regions — ONLY comp within these groups */
export const OCEANFRONT_COMP_REGIONS: Record<string, string[]> = {
  "southampton": ["southampton", "southampton village"],
  "southampton village": ["southampton", "southampton village"],
  "bridgehampton": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "sagaponack": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "water mill": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "wainscott": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "east hampton": ["east hampton"],
  "amagansett": ["amagansett", "montauk"],
  "montauk": ["amagansett", "montauk"],
  "westhampton": ["westhampton", "westhampton beach", "quogue"],
  "westhampton beach": ["westhampton", "westhampton beach", "quogue"],
};

/** General comp regions */
export const COMP_REGIONS: Record<string, string[]> = {
  "southampton": ["southampton", "southampton village"],
  "southampton village": ["southampton", "southampton village"],
  "bridgehampton": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "sagaponack": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "water mill": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "wainscott": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "east hampton": ["east hampton", "wainscott"],
  "amagansett": ["amagansett", "montauk"],
  "montauk": ["amagansett", "montauk"],
  "sag harbor": ["sag harbor", "bridgehampton", "east hampton"],
  "shelter island": ["shelter island", "shelter island heights"],
  "shelter island heights": ["shelter island", "shelter island heights"],
  "springs": ["springs"],
};

/** SOH waterfront fallback regions (wider search) */
export const FALLBACK_REGIONS: Record<string, string[]> = {
  "water mill": ["water mill", "bridgehampton", "sagaponack", "southampton", "wainscott"],
  "bridgehampton": ["bridgehampton", "water mill", "sagaponack", "wainscott", "east hampton"],
  "sagaponack": ["sagaponack", "bridgehampton", "water mill", "wainscott"],
  "southampton": ["southampton", "southampton village", "water mill", "bridgehampton"],
  "southampton village": ["southampton", "southampton village", "water mill", "bridgehampton"],
  "wainscott": ["wainscott", "bridgehampton", "sagaponack", "east hampton", "water mill"],
  "east hampton": ["east hampton", "wainscott", "bridgehampton", "amagansett"],
  "amagansett": ["amagansett", "east hampton", "montauk"],
  "sag harbor": ["sag harbor", "bridgehampton", "east hampton"],
  "shelter island": ["shelter island", "shelter island heights"],
  "montauk": ["montauk", "amagansett"],
};

// =============================================================================
// HAMLET MARKET TIERS & BASE VALUES
// =============================================================================

export const HAMLET_TIERS: Record<string, MarketTier> = {
  "east hampton": "trophy",
  "sagaponack": "trophy",
  "water mill": "trophy",
  "southampton": "upper",
  "southampton village": "upper",
  "amagansett": "upper",
  "sag harbor": "core",
  "bridgehampton": "core",
  "wainscott": "core",
  "shelter island": "core",
  "shelter island heights": "core",
  "montauk": "entry",
  "springs": "entry",
};

export const TIER_RANK: Record<MarketTier, number> = {
  trophy: 4, upper: 3, core: 2, entry: 1,
};

export const HAMLET_BASE_VALUES: Record<string, number> = {
  "east hampton": 8_000_000,
  "southampton": 7_500_000,
  "southampton village": 7_500_000,
  "sagaponack": 9_000_000,
  "bridgehampton": 6_500_000,
  "water mill": 5_500_000,
  "wainscott": 5_000_000,
  "amagansett": 5_000_000,
  "sag harbor": 4_000_000,
  "montauk": 3_500_000,
  "shelter island": 2_500_000,
  "shelter island heights": 2_500_000,
  "springs": 1_100_000,
};

// =============================================================================
// TIME APPRECIATION ADJUSTMENTS
// =============================================================================

export const TIME_ADJUSTMENTS: Record<string, number> = {
  "2020": 1.22, "2021": 1.15, "2022": 1.10,
  "2023": 1.05, "2024": 1.02, "2025": 1.00, "2026": 1.00,
};

// =============================================================================
// PRICE PROXIMITY FILTERING
// =============================================================================

export const PRICE_FILTERS: Record<string, { minRatio: number; maxRatio: number }> = {
  "20m_plus": { minRatio: 0.35, maxRatio: 2.00 },
  "10m_20m": { minRatio: 0.30, maxRatio: 2.20 },
  "5m_10m": { minRatio: 0.25, maxRatio: 2.50 },
  "under_5m": { minRatio: 0.20, maxRatio: 3.00 },
};

// =============================================================================
// SCORING WEIGHTS
// =============================================================================

export const SCORING = {
  // Location category match (25 pts)
  exact_tier_match: 25,
  cross_tier_oceanfront_prime: 15,  // Oceanfront ↔ Prime SOH
  prime_soh_to_noh: 12,
  soh_to_noh: 8,
  different_tier: 0,
  // Hamlet (10 pts)
  same_hamlet: 10,
  // SOH match (8 pts) — skip for oceanfront
  soh_match: 8,
  // Prime road (7 pts)
  prime_road_match: 7,
  // Waterfront
  waterfront_type_match: 10,
  waterfront_mismatch: -15,
  // Bedrooms (12 pts)
  bedrooms_exact: 12,
  bedrooms_diff_1: 8,
  bedrooms_diff_2: 3,
  bedrooms_diff_3plus: 0,
  // Square footage (13 pts) — Vibecode bands
  sqft_85_115: 13,
  sqft_70_130: 7,
  sqft_50_150: 3,
  sqft_beyond_150: 0,
  // Lot size (10 pts normal, 25 pts for land/teardown search)
  lot_normal_max: 10,
  lot_land_search_max: 25,
  lot_large_bonus: 10,  // +10 for 2+ acres
  // Recency (20 pts)
  recency_0_6mo: 20,
  recency_6_12mo: 15,
  recency_12_18mo: 10,
  recency_18_24mo: 5,
  recency_24plus: 2,
  // Distance/proximity (15 pts) — needs geocoding
  proximity_max: 15,
  proximity_decay_per_mile: 7.5,
  // Price tier similarity (15 pts, multi-market only)
  price_tier_70_130: 15,
  price_tier_50_150: 8,
  price_tier_beyond_150: 2,
  // Special bonuses
  new_construction_for_soh_teardown: 20,
  vacant_land_for_noh_teardown: 15,
  low_value_land_on_soh_teardown_penalty: -15,
};

// =============================================================================
// SOH LAND VALUES (Per-Acre) — for lot-based valuation
// =============================================================================

export const SOH_LAND_VALUES = {
  oceanfront_waterfront: 20_000_000,
  prime_soh_waterfront: {
    bayfront: 9_000_000,
    pondfront: 7_800_000,
  },
  sag_harbor_waterfront: {
    bayfront: 6_000_000,
    pondfront: 5_200_000,
  },
  prime_soh_no_waterfront: {
    sagaponack: 9_000_000,
    "east hampton": 8_000_000,
    southampton: 7_000_000,
    bridgehampton: 6_500_000,
    default: 6_000_000,
  } as Record<string, number>,
  standard_soh_no_waterfront: {
    sagaponack: 8_000_000,
    "east hampton": 7_500_000,
    southampton: 6_000_000,
    bridgehampton: 5_500_000,
    "water mill": 5_000_000,
    wainscott: 5_000_000,
    default: 5_000_000,
  } as Record<string, number>,
  shelter_island: {
    waterfront: 3_500_000,
    non_waterfront: 2_250_000,
  },
};

// =============================================================================
// CONDITION MULTIPLIERS
// =============================================================================

export const CONDITION_MULTIPLIERS = {
  renovated: {
    standard: 1.08,
    high_end: 1.12,
    ultra_luxury: 1.20,
  },
  new_construction_for_teardown: {
    standard: 1.20,
    high_end: 1.35,
    ultra_luxury: 1.50,
  },
  existing_home: 1.0,
};

// =============================================================================
// VALUATION BLEND WEIGHTS
// =============================================================================

export const VALUATION_BLEND = {
  // Both PSF and lot available
  both: { psf: 0.55, baseline: 0.30, lot: 0.15 },
  // PSF only
  psf_only: { psf: 0.65, baseline: 0.35 },
  // Lot only
  lot_only: { lot: 0.50, baseline: 0.50 },
  // Baseline only (fallback)
  baseline_only: { baseline: 1.00 },
  // Value range multipliers
  range_low: 0.825,   // avg of 0.80-0.85
  range_high: 1.175,  // avg of 1.15-1.20
};

// =============================================================================
// FALLBACK ESTIMATES (Zero Comps)
// =============================================================================

export const FALLBACK_ESTIMATES: Record<string, Record<string, number>> = {
  hamptons: {
    "east hampton": 8_000_000,
    southampton: 7_500_000,
    bridgehampton: 6_500_000,
    sagaponack: 9_000_000,
    "water mill": 5_500_000,
    wainscott: 5_000_000,
    amagansett: 5_000_000,
    "sag harbor": 4_000_000,
    montauk: 3_500_000,
    "shelter island": 2_500_000,
  },
  palm_beach: {
    "palm beach": 5_250_000,
    manalapan: 8_000_000,
    "jupiter island": 6_000_000,
    "gulf stream": 4_500_000,
  },
  miami: {
    "star island": 45_000_000,
    "fisher island": 18_000_000,
    "indian creek": 30_000_000,
    "miami beach": 800_000,
  },
  aspen: {
    "red mountain": 25_000_000,
    starwood: 18_000_000,
    "aspen core": 5_200_000,
  },
};

// =============================================================================
// CLASSIFICATION ENGINE
// =============================================================================

function normalize(s: string): string {
  return (s || "").toLowerCase().trim();
}

function streetMatch(address: string, streets: string[]): boolean {
  const addr = normalize(address);
  return streets.some(s => addr.includes(s));
}

/**
 * Classify an address into location type, tier, waterfront, and SOH/NOH.
 * This is the core intelligence engine — mirrors what Vibecode does at runtime.
 */
export function classifyAddress(
  address: string,
  village: string
): LocationClassification {
  const addr = normalize(address);
  const vill = normalize(village);

  // Default
  const result: LocationClassification = {
    locationType: "standard",
    locationTier: "Core",
    isSouthOfHighway: false,
    hasWaterfront: false,
    waterfrontType: "none",
    isPrimeRoad: false,
    streetPremium: 1.0,
  };

  // Step 1: Check Tier 1 Oceanfront
  const oceanfrontStreets = TIER1_OCEANFRONT[vill] || [];
  if (streetMatch(addr, oceanfrontStreets)) {
    result.locationType = "tier1_oceanfront";
    result.locationTier = "Trophy";
    result.isSouthOfHighway = true;
    result.hasWaterfront = true;
    result.waterfrontType = "ocean";
    result.isPrimeRoad = true;
  }
  // Step 2: Check SOH Waterfront (bay/pond/cove)
  else if (streetMatch(addr, SOH_WATERFRONT_STREETS[vill] || [])) {
    result.locationType = "soh_waterfront";
    result.locationTier = "Prime";
    result.isSouthOfHighway = true;
    result.hasWaterfront = true;
    // Determine bay vs pond
    if (addr.includes("pond") || addr.includes("kellis") || addr.includes("fairfield") || addr.includes("hook pond") || addr.includes("sagg pond") || addr.includes("peters pond")) {
      result.waterfrontType = "pond";
    } else if (addr.includes("creek") || addr.includes("calf creek") || addr.includes("mill creek")) {
      result.waterfrontType = "creek";
    } else {
      result.waterfrontType = "bay";
    }
    result.isPrimeRoad = true;
  }
  // Step 3: Check Tier 2 Prime SOH
  else if (streetMatch(addr, TIER2_PRIME_SOH[vill] || [])) {
    result.locationType = "tier2_prime_soh";
    result.locationTier = "Prime";
    result.isSouthOfHighway = true;
    result.isPrimeRoad = true;
  }
  // Step 4: Check Tier 4 NOH Waterfront
  else if (streetMatch(addr, TIER4_NOH_WATERFRONT[vill] || [])) {
    result.locationType = "tier4_noh_waterfront";
    result.locationTier = "Core";
    result.isSouthOfHighway = false;
    result.hasWaterfront = true;
    result.waterfrontType = "bay"; // NOH waterfront is typically bay/harbor
  }
  // Step 5: Check SOH by street lists
  else if (streetMatch(addr, SOH_STREETS[vill] || [])) {
    result.locationType = "tier3_soh";
    result.locationTier = "Premium";
    result.isSouthOfHighway = true;
  }
  // Step 6: Check SOH by keywords (fallback)
  else if (SOH_KEYWORDS.some(kw => addr.includes(kw))) {
    result.locationType = "tier3_soh";
    result.locationTier = "Premium";
    result.isSouthOfHighway = true;
  }
  // Step 7: Special areas
  else if (vill === "springs") {
    result.locationType = "springs";
    result.locationTier = "Entry";
  }
  else if (addr.includes("northwest woods")) {
    result.locationType = "northwest_woods";
    result.locationTier = "Core";
  }
  // Step 8: NOH village locations
  else if (["sag harbor", "east hampton village", "southampton village", "bridgehampton"].includes(vill)) {
    result.locationType = "noh_village";
    result.locationTier = "Core";
  }
  // Default: NOH standard
  else {
    result.locationType = "noh_standard";
    result.locationTier = "Core";
  }

  // Street premium lookup
  const premiums = STREET_PREMIUMS[vill];
  if (premiums) {
    for (const [street, mult] of Object.entries(premiums)) {
      if (addr.includes(street)) {
        result.streetPremium = mult;
        result.isPrimeRoad = true;
        break;
      }
    }
  }

  return result;
}

/**
 * Check if two properties should be comped against each other based on
 * waterfront type and location tier rules.
 */
export function areComparable(
  subject: LocationClassification,
  comp: LocationClassification
): { comparable: boolean; penalty: number; reason?: string } {
  // Rule: Tier 1 (oceanfront) ONLY comps against Tier 1
  if (subject.locationType === "tier1_oceanfront" && comp.locationType !== "tier1_oceanfront") {
    return { comparable: false, penalty: -30, reason: "Oceanfront should only comp against oceanfront" };
  }
  if (comp.locationType === "tier1_oceanfront" && subject.locationType !== "tier1_oceanfront") {
    return { comparable: false, penalty: -30, reason: "Non-oceanfront should not comp against oceanfront" };
  }

  // Rule: Tier 2 (prime SOH) should not comp against NOH
  if (subject.isSouthOfHighway && !comp.isSouthOfHighway) {
    return { comparable: true, penalty: -15, reason: "SOH vs NOH mismatch" };
  }
  if (!subject.isSouthOfHighway && comp.isSouthOfHighway) {
    return { comparable: true, penalty: -15, reason: "NOH vs SOH mismatch" };
  }

  // Rule: Springs should never comp against EH Village or SOH
  if (subject.locationType === "springs" && (comp.isSouthOfHighway || comp.locationType === "noh_village")) {
    return { comparable: false, penalty: -25, reason: "Springs should not comp against village/SOH" };
  }

  // Waterfront type matching
  if (subject.hasWaterfront && comp.hasWaterfront) {
    if (subject.waterfrontType === comp.waterfrontType) {
      return { comparable: true, penalty: 10, reason: "Exact waterfront match bonus" };
    }
    // Ocean vs bay/pond is still a mismatch
    if (subject.waterfrontType === "ocean" && comp.waterfrontType !== "ocean") {
      return { comparable: true, penalty: -10, reason: "Oceanfront vs other waterfront" };
    }
    return { comparable: true, penalty: 0 };
  }

  if (subject.hasWaterfront && !comp.hasWaterfront) {
    return { comparable: true, penalty: -10, reason: "Waterfront vs non-waterfront" };
  }
  if (!subject.hasWaterfront && comp.hasWaterfront) {
    return { comparable: true, penalty: -5, reason: "Non-waterfront vs waterfront" };
  }

  return { comparable: true, penalty: 0 };
}