import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Generate a URL-friendly slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
}

// Seed data for articles
const articlesData = [
  // ==================== HAMPTONS ====================
  {
    title: "South Fork Market Posts Fourth Consecutive Quarter of Growth",
    subtitle: "Sustained demand drives luxury segment momentum across the East End",
    excerpt: "The Hamptons residential market continues to demonstrate resilience as Q4 figures reveal the fourth straight quarter of year-over-year gains in transaction volume.",
    content: `The South Fork real estate market has posted its fourth consecutive quarter of growth, according to the latest market analysis, with transaction volume and median prices both showing sustained improvement across the East End's most sought-after communities.

The quarter saw notable activity in the luxury segment, with properties priced above $10 million demonstrating particularly strong velocity. Southampton Village emerged as a standout performer, with high-end transactions significantly outpacing prior-year figures.

Market observers note that inventory constraints continue to underpin pricing strength, particularly for turn-key estates and oceanfront properties. The premium commanded by move-in-ready homes has expanded, reflecting buyer preferences in a market where renovation costs and timelines have become less predictable.

Transaction data reveals a bifurcation in market activity, with the ultra-luxury tier ($20M+) showing robust demand while the entry-level segment faces continued inventory pressure. Properties requiring substantial renovation are trading at notable discounts, offering opportunities for buyers with longer time horizons.

Real estate professionals describe buyer sentiment as cautiously optimistic, with demand remaining robust among both primary residence seekers and those acquiring secondary homes.`,
    imageUrl: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=600&fit=crop",
    author: "Editorial Staff",
    category: "market",
    location: "South Fork",
    marketId: "hamptons",
    readingTime: 4,
    featured: true,
    pullQuote: "The premium commanded by turn-key estates has expanded notably this quarter.",
    statValue: "4",
    statLabel: "Consecutive quarters of growth",
  },
  {
    title: "Meadow Lane Estate Trades for $32 Million",
    subtitle: "Southampton Village oceanfront sets 2026 benchmark",
    excerpt: "A storied Meadow Lane estate has changed hands in what stands as the highest-priced transaction of 2026, setting a new benchmark for Southampton Village oceanfront.",
    content: `A storied oceanfront estate on Southampton Village's Meadow Lane has traded for $32 million, establishing the benchmark transaction for 2026 and underscoring continued strength in the ultra-luxury segment.

The property, which encompasses direct ocean frontage and substantial acreage, represents one of the legacy estates along what is widely considered among the most prestigious addresses in the Hamptons. The transaction occurred privately, with details emerging through market tracking reports.

Real estate advisors familiar with the market note that Meadow Lane transactions remain rare events, given the concentration of long-term family ownership along the road. When properties do trade, they typically command significant premiums reflecting both the address and the scarcity of available alternatives.

The sale follows a pattern of robust ultra-luxury activity that has characterized the Southampton Village market, where properties above $10 million have traded at an accelerated pace compared to prior periods.`,
    imageUrl: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&h=600&fit=crop",
    author: "Michael Chen",
    category: "trades",
    location: "Southampton Village",
    marketId: "hamptons",
    readingTime: 3,
    featured: true,
    pullQuote: "Meadow Lane transactions remain rare events.",
    statValue: "$32M",
    statLabel: "Transaction price",
  },

  // ==================== PALM BEACH ====================
  {
    title: "Palm Beach Posts Record Q4 as Luxury Demand Surges",
    subtitle: "Island market sees unprecedented activity in $20M+ segment",
    excerpt: "Palm Beach recorded its strongest fourth quarter on record, with ultra-luxury transactions driving unprecedented dollar volume across the island.",
    content: `Palm Beach has recorded its strongest fourth quarter in history, with luxury property transactions driving record dollar volume across the exclusive island market. The $20 million-plus segment showed particular strength, with multiple trophy properties changing hands.

The island's unique positioning as a secure, established luxury enclave continues to attract high-net-worth buyers seeking both primary and secondary residences. Market observers note that the combination of limited supply and sustained demand has created favorable conditions for sellers of quality properties.

South Ocean Boulevard, the island's most prestigious oceanfront address, saw several significant transactions during the quarter. Meanwhile, lakefront properties along the Intracoastal Waterway also demonstrated strong activity, offering an alternative to oceanfront buyers priced out of that segment.

Real estate advisors report that buyer profiles continue to diversify, with increased interest from international purchasers alongside traditional domestic buyers relocating from Northeast markets.`,
    imageUrl: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&h=600&fit=crop",
    author: "Editorial Staff",
    category: "market",
    location: "Palm Beach Island",
    marketId: "palm-beach",
    readingTime: 4,
    featured: true,
    pullQuote: "The island's unique positioning continues to attract high-net-worth buyers.",
    statValue: "Record",
    statLabel: "Q4 Performance",
  },
  {
    title: "South Ocean Boulevard Estate Commands $89 Million",
    subtitle: "Oceanfront compound sets new Palm Beach record",
    excerpt: "A sprawling oceanfront estate on South Ocean Boulevard has sold for $89 million, establishing a new benchmark for Palm Beach residential transactions.",
    content: `A magnificent oceanfront compound on South Ocean Boulevard has traded for $89 million, setting a new record for Palm Beach residential sales and underscoring the continued appetite for trophy properties in the elite island market.

The estate, encompassing over 200 feet of direct ocean frontage and 2.1 acres of grounds, represents one of the most significant offerings to come to market in recent years. The property includes the main residence, guest house, tennis court, and oceanfront pool pavilion.

Market analysts note that such transactions, while exceptional in price, reflect broader trends in the ultra-luxury segment where qualified buyers demonstrate willingness to pay substantial premiums for exceptional properties with irreplaceable attributes.

The sale reinforces Palm Beach's position among the most exclusive residential markets globally, with pricing increasingly aligned with comparable oceanfront markets in international destinations.`,
    imageUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&h=600&fit=crop",
    author: "Victoria Chase",
    category: "trades",
    location: "South Ocean Boulevard",
    marketId: "palm-beach",
    readingTime: 3,
    featured: true,
    pullQuote: "Qualified buyers demonstrate willingness to pay substantial premiums for exceptional properties.",
    statValue: "$89M",
    statLabel: "Record sale price",
  },
  {
    title: "$6.4 Billion in Five Years: Palm Beach Transaction Data Reveals Market Surge",
    subtitle: "437 tracked sales from 2021-2026 paint picture of sustained luxury demand",
    excerpt: "An analysis of 437 recorded transactions from 2021 through early 2026 reveals a market where median prices climbed 65% and annual volume reached $2.3 billion.",
    content: `Palm Beach's luxury market has generated $6.4 billion in tracked sales volume across 437 transactions from 2021 through February 2026. The median sale price climbed from $7.78 million in 2021 to $12.8 million in 2025, a 65% increase.

2025 stands out as the highest-volume year, with 125 recorded sales generating $2.32 billion. The price-per-square-foot metric rose from $1,921 in 2021 to $2,626 in 2025, a 37% increase.

At the ultra-luxury tier, eight transactions exceeded $50 million since 2021. The record belongs to 10 Tarpon Isle at $152 million in May 2024, followed by 1840 South Ocean Boulevard at $109.6 million. These trophy sales have become regular occurrences rather than generational events.

The data confirms what market participants have observed: Palm Beach operates in its own economic ecosystem, driven by cash-dominant ultra-high-net-worth buyers insulated from interest rate sensitivity.`,
    imageUrl: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=600&fit=crop",
    author: "Palm Beach Editorial",
    category: "market",
    location: "Palm Beach Island",
    marketId: "palm-beach",
    readingTime: 4,
    featured: true,
    pullQuote: "The median sale price climbed 65% in four years to $12.8 million.",
    statValue: "$6.4B",
    statLabel: "Total tracked volume",
  },
  {
    title: "10 Tarpon Isle Closes at $152 Million, Shattering Palm Beach Record",
    subtitle: "The 21,406-square-foot estate at $7,101/SF joins rarified company worldwide",
    excerpt: "The record-shattering sale of 10 Tarpon Isle in May 2024 established Palm Beach as a permanent member of the $100M+ club alongside Bel Air and Belgravia.",
    content: `When 10 Tarpon Isle closed at $152 million in May 2024, it did more than set a record. At 21,406 square feet and approximately $7,101 per square foot, the transaction established Palm Beach among the world's most elite residential markets.

The pattern of ceiling-breaking transactions has accelerated over five years. In 2021, the highest recorded sale was $109.6M at 1840 South Ocean Boulevard. By 2024, Tarpon Isle pushed the record to $152M, followed by 1446 N Ocean Boulevard at $81M ($10,119/SF) in November 2024.

The price-per-square-foot leaderboard reveals dramatic premiums for oceanfront addresses: $12,295/SF at 220 Jungle Road, $10,119/SF at 1446 N Ocean, $9,587/SF at 11465 Old Harbour Road.

Each ceiling-breaking sale recalibrates comparable values across the island. When Tarpon Isle closes at $152M, every oceanfront estate within a mile radius benefits from an upward adjustment in perceived value.`,
    imageUrl: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&h=600&fit=crop",
    author: "Palm Beach Editorial",
    category: "trades",
    location: "Tarpon Isle",
    marketId: "palm-beach",
    readingTime: 3,
    featured: false,
    pullQuote: "Each ceiling-breaking sale recalibrates comparable values across the island.",
    statValue: "$152M",
    statLabel: "Record transaction",
  },

  // ==================== MIAMI BEACH ====================
  {
    title: "Miami Beach Ultra-Luxury Market Surges in Early 2026",
    subtitle: "Record $10M+ contracts signal sustained demand for beachfront living",
    excerpt: "Miami Beach's ultra-luxury segment opens 2026 with record contract activity, as cash-rich international buyers drive demand across South of Fifth, Mid-Beach, and Bal Harbour.",
    content: `Miami Beach's ultra-luxury segment is writing its own narrative in early 2026, one of unprecedented strength. January opened with record contract activity above $10 million, marking the strongest start to a year for the barrier island's highest price tier.

Cash remains king in this rarified segment. Across Miami Beach's luxury landscape, between 50 and 70 percent of transactions close without financing, a structural advantage that insulates the market from interest rate fluctuations. This liquidity allows Miami Beach buyers to offer terms that sellers in leverage-dependent markets simply cannot match.

The international component continues to strengthen Miami Beach's position. International buyers accounted for over half of new-construction condo sales, with purchasers hailing from 73 countries. Latin American and European buyers show particularly vigorous activity, drawn by Miami Beach's cultural connectivity and relative value compared to London and New York.

South of Fifth, Bal Harbour, and Mid-Beach continue to command the highest premiums, with La Gorce Island recently setting a price-per-foot record at $6,224 per square foot for a meticulously designed waterfront residence.`,
    imageUrl: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&h=600&fit=crop",
    author: "Miami Beach Editorial",
    category: "market",
    location: "Miami Beach",
    marketId: "miami",
    readingTime: 4,
    featured: true,
    pullQuote: "International buyer activity has returned to pre-pandemic levels.",
    statValue: "Record",
    statLabel: "$10M+ contracts",
  },
  {
    title: "La Gorce Island Sets Price-Per-Foot Record at $6,224",
    subtitle: "Waterfront spec home establishes new Miami Beach benchmark",
    excerpt: "A meticulously designed waterfront home on La Gorce Island has sold for $60 million, setting a new price-per-square-foot record for Miami Beach single-family residences.",
    content: `A waterfront home on La Gorce Island has sold for $60 million, translating to $6,224 per square foot�a new record for Miami Beach single-family residences. The transaction demonstrates that quality, design, and execution can command premiums that exceed even the market's most optimistic expectations.

The sellers invested four years in creating what they describe as an architectural statement. At 9,640 square feet, the home is not notably large by ultra-luxury standards; the value lies in execution rather than scale. Architect Max Strang designed the residence, with interiors by New York's Pembrooke & Ives.

La Gorce Island itself contributes to the record pricing. The private island community, connected to Miami Beach by a single bridge, offers security and exclusivity that open neighborhoods cannot match. Properties here trade infrequently; when they do, buyer competition drives aggressive valuations.

The $6,224 price per square foot reframes how Miami Beach's luxury market should be understood. Raw square footage has never been the primary value driver at the highest tier; the La Gorce sale quantifies how much premium quality design can command.`,
    imageUrl: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800&h=600&fit=crop",
    author: "Miami Beach Editorial",
    category: "trades",
    location: "La Gorce Island",
    marketId: "miami",
    readingTime: 3,
    featured: true,
    pullQuote: "Quality, design, and execution command premiums that exceed expectations.",
    statValue: "$6,224",
    statLabel: "Price per sqft",
  },

  // ==================== ASPEN ====================
  {
    title: "Aspen's Ski Season Opens with Record Asking Prices",
    subtitle: "Limited inventory drives luxury pricing to new heights",
    excerpt: "Aspen's luxury real estate market has entered the winter season with asking prices at record levels, as limited inventory and sustained demand create favorable conditions for sellers.",
    content: `Aspen's luxury real estate market has entered the 2026 ski season with asking prices reaching record levels, as the combination of limited inventory and robust demand creates increasingly competitive conditions for buyers seeking premium mountain properties.

Red Mountain, the market's most exclusive ski-in/ski-out neighborhood, has seen several new listings priced above $70 million, reflecting both construction costs and the irreplaceable nature of ski-accessible lots. The neighborhood's proximity to Aspen Mountain gondola ensures continued demand among serious skiers.

Downtown Aspen has also demonstrated strength, with historic Victorian renovations and contemporary constructions both attracting buyer interest. The walkability factor commands substantial premiums, with properties within steps of the gondola trading at significant markups.

Market observers note that Aspen's appeal extends beyond ski season, with summer programming and year-round cultural events making the mountain town an increasingly attractive primary residence option for buyers seeking quality of life.`,
    imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop",
    author: "Editorial Staff",
    category: "market",
    location: "Aspen",
    marketId: "aspen",
    readingTime: 4,
    featured: true,
    pullQuote: "Red Mountain's proximity to Aspen Mountain gondola ensures continued demand.",
    statValue: "Record",
    statLabel: "Asking prices",
  },
  {
    title: "Red Mountain Estate Commands $78 Million",
    subtitle: "Ski-in/ski-out compound sets Aspen record",
    excerpt: "A sprawling ski-in/ski-out estate on Aspen's prestigious Red Mountain has sold for $78 million, establishing a new record for the Colorado mountain market.",
    content: `A magnificent ski-in/ski-out estate on Aspen's exclusive Red Mountain has traded for $78 million, setting a new record for the Colorado luxury market and underscoring continued global demand for premier mountain properties.

The compound, spanning over 14,000 square feet on 5.2 acres, offers direct ski access to Aspen Mountain along with panoramic views of the Elk Range. The property includes the main residence, a separate guest house, heated driveway, and extensive outdoor entertaining areas.

Real estate advisors familiar with the market note that ski-accessible properties on Red Mountain represent some of the most coveted residential real estate in North America. The combination of location, views, and privacy creates trophy assets that rarely come to market.

The transaction reflects broader trends in the ultra-luxury mountain market, where buyers increasingly view premier ski properties as long-term holdings comparable to oceanfront estates in coastal markets.`,
    imageUrl: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&h=600&fit=crop",
    author: "William Crawford",
    category: "trades",
    location: "Red Mountain",
    marketId: "aspen",
    readingTime: 3,
    featured: true,
    pullQuote: "Ski-accessible properties on Red Mountain represent some of the most coveted residential real estate.",
    statValue: "$78M",
    statLabel: "Record sale price",
  },
  // ==================== ASPEN DATA-DRIVEN ====================
  {
    title: "$6.6 Billion Mountain: Inside 763 Aspen Sales That Redefined Luxury",
    subtitle: "Comprehensive analysis of tracked Aspen transactions",
    excerpt: "A comprehensive analysis of 763 tracked transactions reveals $6.62B in total volume, a $5.47M median spanning condos to $108M estates.",
    content: `An exhaustive analysis of 763 Aspen real estate transactions has produced figures that confirm what market participants have long suspected: Aspen has become one of the most expensive residential markets on Earth, with $6.62 billion in total tracked volume and a median sale price of $5.47 million.

The $2M-$5M range is the largest segment at 32%, followed by $10M-$20M at 31%. Above $20M, 35 sales have occurred, including eight above $50 million. The record: $108 million at 419 Willoughby Way.

Calderwood leads in volume at $1.11B across 73 sales, while Red Mountain commands the highest median at $28.8M. The median $/SF is $2,408, ranging from under $500/SF to $8,758/SF at 1215 E Cooper Ave Unit F5.`,
    imageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&h=600&fit=crop",
    author: "Editorial Staff",
    category: "market",
    location: "Aspen",
    marketId: "aspen",
    readingTime: 4,
    featured: true,
    pullQuote: "763 transactions spanning $880K to $108M demonstrates structural demand.",
    statValue: "$6.62B",
    statLabel: "Total tracked volume",
  },
  {
    title: "Calderwood vs. Red Mountain: Aspen's Price Geography",
    subtitle: "Neighborhood-level analysis from 537 real transactions",
    excerpt: "Calderwood leads in volume ($1.11B across 73 sales) while Red Mountain commands the highest medians at $28.8M per transaction.",
    content: `Calderwood leads overwhelmingly in volume: $1.11 billion across 73 tracked sales. Red Mountain, with fewer transactions (18), commands the highest median at $28.8M and $636M in total volume. West End's $24.5M median across 12 sales positions it between these poles.

Townsend of Aspen recorded 27 sales at a $15.4M median, generating $427M. Meadowood shows 12 sales at $14.7M median. Snowmass Village: 11 sales at $9.4M median. Starwood: 11 sales at $6.3M median.

The overall market median of $2,408/SF obscures enormous neighborhood variation. Red Mountain and West End exceed $5,000/SF for top properties.`,
    imageUrl: "https://images.unsplash.com/photo-1518732714860-b62714ce0c59?w=800&h=600&fit=crop",
    author: "Editorial Staff",
    category: "market",
    location: "Aspen",
    marketId: "aspen",
    readingTime: 4,
    featured: false,
    pullQuote: "Calderwood dominates in transaction count: 73 sales totaling $1.11 billion.",
    statValue: "$28.8M",
    statLabel: "Red Mountain median",
  },
];

// Seed data for listings
const listingsData = [
  // ==================== HAMPTONS ====================
  {
    address: "142 Lily Pond Lane",
    village: "East Hampton",
    marketId: "hamptons",
    price: 42500000,
    listingType: "sale",
    beds: 7,
    baths: 9,
    sqft: 12500,
    acres: 2.1,
    yearBuilt: 2018,
    imageUrl: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80",
    brokerName: "Michael Chen",
    brokerCompany: "Sotheby's International Realty",
    brokerPhone: "631-555-0142",
    featured: true,
    description: "Exceptional new construction on one of the most coveted lanes in East Hampton. This architectural masterpiece features floor-to-ceiling windows, heated gunite pool, and private tennis court.",
  },
  {
    address: "89 Ocean Road",
    village: "Bridgehampton",
    marketId: "hamptons",
    price: 28750000,
    listingType: "sale",
    beds: 6,
    baths: 7,
    sqft: 9800,
    acres: 1.8,
    yearBuilt: 2020,
    imageUrl: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80",
    brokerName: "Sarah Williams",
    brokerCompany: "Douglas Elliman",
    brokerPhone: "631-555-0189",
    featured: true,
    description: "Modern oceanview estate with stunning sunset views. Features include chef's kitchen with Wolf appliances, wine cellar, home theater, and resort-style infinity pool.",
  },
  {
    address: "55 Meadow Lane",
    village: "Southampton",
    marketId: "hamptons",
    price: 67000000,
    listingType: "sale",
    beds: 10,
    baths: 12,
    sqft: 18000,
    acres: 4.2,
    yearBuilt: 2016,
    imageUrl: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80",
    brokerName: "David Thompson",
    brokerCompany: "Brown Harris Stevens",
    brokerPhone: "631-555-0155",
    featured: true,
    description: "Iconic oceanfront compound on prestigious Meadow Lane. This trophy property features 300 feet of ocean frontage, tennis court, pool house, and unparalleled privacy.",
  },

  // ==================== PALM BEACH ====================
  {
    address: "1200 South Ocean Boulevard",
    village: "Palm Beach Island",
    marketId: "palm-beach",
    price: 89000000,
    listingType: "sale",
    beds: 9,
    baths: 14,
    sqft: 22000,
    acres: 1.8,
    yearBuilt: 2021,
    imageUrl: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&q=80",
    brokerName: "Elizabeth Sterling",
    brokerCompany: "Premier Estate Properties",
    brokerPhone: "561-555-0189",
    featured: true,
    description: "Magnificent oceanfront estate on Billionaire's Row with 200 feet of direct ocean frontage. This newly constructed masterpiece offers unparalleled luxury with ocean and Intracoastal views.",
  },
  {
    address: "456 North Lake Way",
    village: "Palm Beach Island",
    marketId: "palm-beach",
    price: 45000000,
    listingType: "sale",
    beds: 7,
    baths: 9,
    sqft: 14500,
    acres: 0.9,
    yearBuilt: 2019,
    imageUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80",
    brokerName: "James Worthington",
    brokerCompany: "Sotheby's International Realty",
    brokerPhone: "561-555-0145",
    featured: true,
    description: "Exquisite lakefront estate with private dock and stunning sunset views over the Intracoastal Waterway. Mediterranean-inspired architecture with modern amenities throughout.",
  },
  {
    address: "789 Wells Road",
    village: "Palm Beach Island",
    marketId: "palm-beach",
    price: 28500000,
    listingType: "sale",
    beds: 6,
    baths: 8,
    sqft: 9800,
    acres: 0.6,
    yearBuilt: 2022,
    imageUrl: "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=800&q=80",
    brokerName: "Victoria Chase",
    brokerCompany: "Douglas Elliman",
    brokerPhone: "561-555-0167",
    featured: false,
    description: "Newly constructed contemporary residence in coveted Estate Section. Features include open floor plan, chef's kitchen, home theater, and resort-style pool with summer kitchen.",
  },

  // ==================== MIAMI BEACH ====================
  {
    address: "42 Star Island Drive",
    village: "Star Island",
    marketId: "miami",
    price: 65000000,
    listingType: "sale",
    beds: 8,
    baths: 11,
    sqft: 16500,
    acres: 1.2,
    yearBuilt: 2020,
    imageUrl: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80",
    brokerName: "Carlos Rodriguez",
    brokerCompany: "ONE Sotheby's International Realty",
    brokerPhone: "305-555-0142",
    featured: true,
    description: "Ultra-private waterfront estate on exclusive Star Island with 180 feet of waterfront, private dock for superyacht, infinity pool, and panoramic Biscayne Bay views.",
  },
  {
    address: "321 Ocean Drive PH",
    village: "South of Fifth",
    marketId: "miami",
    price: 28000000,
    listingType: "sale",
    beds: 5,
    baths: 6,
    sqft: 7200,
    yearBuilt: 2023,
    imageUrl: "https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?w=800&q=80",
    brokerName: "Maria Santos",
    brokerCompany: "Compass",
    brokerPhone: "305-555-0198",
    featured: true,
    description: "Full-floor penthouse in South of Fifth's most exclusive oceanfront tower. Features include 12-foot ceilings, wraparound terraces, private elevator, and unobstructed Atlantic Ocean views.",
  },
  {
    address: "88 La Gorce Circle",
    village: "La Gorce Island",
    marketId: "miami",
    price: 45000000,
    listingType: "sale",
    beds: 7,
    baths: 9,
    sqft: 12000,
    acres: 0.8,
    yearBuilt: 2021,
    imageUrl: "https://images.unsplash.com/photo-1600607687644-aac4c3eac7f4?w=800&q=80",
    brokerName: "Roberto Fernandez",
    brokerCompany: "The Jills Zeder Group",
    brokerPhone: "305-555-0156",
    featured: false,
    description: "Architectural masterpiece on ultra-private La Gorce Island. This waterfront estate features 200 feet of bay frontage, private dock, resort-style pool, and Max Strang-designed interiors.",
  },

  // ==================== ASPEN ====================
  {
    address: "300 Red Mountain Road",
    village: "Red Mountain",
    marketId: "aspen",
    price: 78000000,
    listingType: "sale",
    beds: 7,
    baths: 9,
    sqft: 14000,
    acres: 5.2,
    yearBuilt: 2019,
    imageUrl: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80",
    brokerName: "William Crawford",
    brokerCompany: "Aspen Snowmass Sotheby's",
    brokerPhone: "970-555-0142",
    featured: true,
    description: "Exceptional ski-in/ski-out estate on Red Mountain with panoramic views of Aspen Mountain and the Elk Range. Features include wine cellar, home theater, heated driveway, and separate guest quarters.",
  },
  {
    address: "520 West Smuggler Street",
    village: "West End",
    marketId: "aspen",
    price: 32000000,
    listingType: "sale",
    beds: 5,
    baths: 6,
    sqft: 7200,
    acres: 0.3,
    yearBuilt: 2021,
    imageUrl: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80",
    brokerName: "Katherine Hayes",
    brokerCompany: "Christie's International Real Estate",
    brokerPhone: "970-555-0167",
    featured: true,
    description: "Stunning new construction in Aspen's historic West End, walking distance to downtown and Aspen Mountain gondola. Contemporary mountain design with premium finishes throughout.",
  },
  {
    address: "1000 Willoughby Way",
    village: "Starwood",
    marketId: "aspen",
    price: 45000000,
    listingType: "sale",
    beds: 6,
    baths: 8,
    sqft: 12000,
    acres: 35,
    yearBuilt: 2017,
    imageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80",
    brokerName: "Michael Andrews",
    brokerCompany: "Douglas Elliman",
    brokerPhone: "970-555-0189",
    featured: false,
    description: "Spectacular 35-acre Starwood estate with unobstructed views of the Continental Divide. This private compound includes main residence, caretaker's quarters, equestrian facilities, and direct national forest access.",
  },
];

async function main() {
  console.log("Seeding database...");

  // Clear existing data
  await prisma.article.deleteMany();
  await prisma.listing.deleteMany();

  console.log("Cleared existing data.");

  // Seed articles
  for (const article of articlesData) {
    const slug = generateSlug(article.title);
    await prisma.article.create({
      data: {
        slug,
        title: article.title,
        subtitle: article.subtitle,
        excerpt: article.excerpt,
        content: article.content,
        category: article.category,
        author: article.author,
        location: article.location,
        market_id: article.marketId,
        image_url: article.imageUrl,
        reading_time: article.readingTime,
        featured: article.featured,
        pull_quote: article.pullQuote,
        stat_value: article.statValue,
        stat_label: article.statLabel,
        published_at: new Date(),
      },
    });
    console.log(`Created article: ${article.title}`);
  }

  // Seed listings
  for (const listing of listingsData) {
    await prisma.listing.create({
      data: {
        address: listing.address,
        village: listing.village,
        market_id: listing.marketId,
        price: listing.price,
        listing_type: listing.listingType,
        beds: listing.beds,
        baths: listing.baths,
        sqft: listing.sqft,
        acres: listing.acres,
        year_built: listing.yearBuilt,
        image_url: listing.imageUrl,
        broker_name: listing.brokerName,
        broker_company: listing.brokerCompany,
        broker_phone: listing.brokerPhone,
        description: listing.description,
        featured: listing.featured,
      },
    });
    console.log(`Created listing: ${listing.address}`);
  }

  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });