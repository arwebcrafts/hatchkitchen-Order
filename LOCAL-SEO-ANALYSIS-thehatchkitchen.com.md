# Local SEO Analysis: Hatch Kitchen

**Date:** 2026-07-16  
**GBP / Maps:** [HATCH KITCHEN](https://www.google.com/maps?cid=17184789989184635926)  
**Coordinates (from GBP URL):** 34.0555889, -118.3870534  
**Website:** https://www.thehatchkitchen.com/ (analyzed from local project files)  
**Capability tier:** Tier 0 (DataForSEO MCP not available). Live GBP Insights, review velocity, and geo-grid ranks were not pulled via API.

## Local SEO Score: 72/100

| Dimension | Weight | Score | Notes |
|-----------|--------|-------|-------|
| GBP signals | 25% | 18/25 | Place exists; site now links embed/`sameAs`/`hasMap` to GBP CID. Category/posts/photos not verifiable without GBP API. |
| Reviews & reputation | 20% | 10/20 | Yelp presence linked in schema; Google rating/count/velocity not verified in this run. |
| Local on-page SEO | 20% | 17/20 | Strong Pico-Robertson titles, Visit page, menu/catering service pages, `tel:` links, map embeds. |
| NAP & citations | 15% | 9/15 | Site NAP consistent; **citations show a conflicting phone (818)**. |
| Local schema | 10% | 8/10 | Correct `Restaurant` type + hours; geo/hasMap/GBP `sameAs` added. No `aggregateRating` yet. |
| Local links & authority | 10% | 6/10 | Great Kosher Restaurants listing; Instagram. Limited chamber/press/"best of" signals found. |

## Business type

**Brick-and-mortar restaurant** (street address, hours, map pin, dine-in / pickup / delivery / catering).

## Industry vertical

**Restaurant** (kosher quick-service / cafe). Signals: menu page, Toast order link, cuisine terms, OK Kosher.

## GBP optimization checklist

| Item | Status |
|------|--------|
| Claimed Maps place for 8947 W Pico Blvd | Present (user-provided GBP URL) |
| Address matches site | Match: 8947 West Pico Boulevard, Los Angeles, CA 90035 |
| Website maps embed pinned to GBP CID | Updated on `index.html` + `contact.html` |
| Schema `hasMap` + `sameAs` → GBP | Updated on `index.html` |
| Schema `geo` (5+ decimals) | Updated to GBP lat/lng |
| Primary category correct | Unverified (needs GBP dashboard: e.g. Kosher restaurant / Cafe) |
| Secondary categories (up to ~4) | Unverified |
| Photos / menu photos | Unverified on GBP; strong food photos on site |
| GBP posts cadence | Unverified |
| Hours match site + schema | Site: Sun–Thu 9–8, Fri 9–3. Confirm identical on GBP (directory scrapers disagree) |
| Attributes (kosher, outdoor, takeout, delivery) | Unverified; should match Toast + site claims |
| Products / menu on GBP | Unverified |
| Review response habit | Unverified |

## Review health snapshot

- **Google:** rating, count, and last-review date **not verified** this run (Maps HTML blocked / no DataForSEO).
- **Yelp:** listed (`hatch-kitchen-los-angeles`); MapQuest syndication showed ~5 reviews / ~5.0 (third-party snapshot, not live Yelp scrape).
- **Action:** confirm Google has 10+ reviews, 4.5+ average, and a new review within ~18 days; reply to every review.

## NAP consistency audit

| Source | Name | Address | Phone |
|--------|------|---------|-------|
| Site visible (topbar/footer/Visit) | Hatch Kitchen | 8947 West Pico Boulevard, Los Angeles, CA 90035 | (424) 455-3195 |
| Site JSON-LD (`Restaurant`) | Hatch Kitchen | same | +1-424-455-3195 |
| GBP place URL | HATCH KITCHEN | 8947 W Pico Blvd (from Maps place) | not scraped |
| Great Kosher Restaurants | Hatch Kitchen | 8947 W Pico Blvd | (424) 455-3195 |
| MenuPix / MapQuest feeds | Hatch Kitchen | 8947 W Pico Blvd | **(818) 335-5540** |

**Critical:** phone citation split between **(424) 455-3195** (site + kosher directory) and **(818) 335-5540** (some aggregators). Pick one canonical phone and correct every listing.

GBP display name casing (`HATCH KITCHEN` vs `Hatch Kitchen`) is usually fine; keep website title case.

## Citation presence check (Tier 1ish)

| Directory | Detected |
|-----------|----------|
| Google Business Profile | Yes (URL provided) |
| Yelp | Yes (linked in schema) |
| Instagram | Yes |
| Great Kosher Restaurants | Yes |
| BBB | Not found |
| Apple Business Connect | Not checked / recommend claim |
| Bing Places | Not checked / recommend claim (powers ChatGPT local) |
| OpenStreetMap POI named Hatch Kitchen | Not found near pin (address geocodes; business node missing) |

## Local schema status

**Present on homepage:** `@type: Restaurant` with name, url, telephone, email, cuisine, priceRange, menu, address, openingHoursSpecification.

**Just fixed:** `geo`, `hasMap`, GBP in `sameAs`.

**Still missing / optional:**
- `aggregateRating` (only after verified Google/Yelp counts)
- `image` should be absolute HTTPS URL (currently relative `images/ai-hero.jpg`)
- Menu / MenuSection markup (restaurant-specific pattern)
- Contact page is FAQPage only (OK); keep primary Restaurant entity on the homepage (or add duplicate Restaurant on Visit with same `@id`)

## Location page quality

Single location. Visit page (`contact.html`) has unique Pico-Robertson copy, hours, storefront photo, FAQ, map. Not a doorway page. No multi-location risk.

## Top 10 prioritized actions

1. **Critical:** Resolve phone NAP across the web to **(424) 455-3195** (or switch site if 818 is correct). Fix MenuPix/Yelp/MapQuest/Apple/Bing if wrong.
2. **Critical:** In GBP, lock hours to Sun–Thu 9AM–8PM, Fri 9AM–3PM (or update the site if GBP is the truth). Scrapers currently disagree.
3. **High:** Confirm primary category + add strong secondaries (Kosher restaurant, Cafe, Salad shop, Juice bar, etc.).
4. **High:** Review engine: get past 10 Google reviews and keep velocity under the 18-day cliff; respond to all.
5. **High:** Claim/optimize Apple Business Connect + Bing Places.
6. **High:** Add absolute `image` + optional `aggregateRating` once counts are confirmed.
7. **Medium:** Create/claim OSM node for Hatch Kitchen at the GBP pin (helps Apple/third-party maps).
8. **Medium:** GBP weekly posts (specials, Shabbat hours, catering) using real food photos.
9. **Medium:** Ensure GBP website button points to the site homepage (or Visit), not only the strongest organic page, per Sterling Sky diversity guidance.
10. **Low:** Pursue kosher/"best of LA" list placements for AI visibility (ChatGPT leans on Bing/Yelp/lists, not GBP directly).

## Limitations

Could not assess: real-time local pack position, geo-grid SoLV, Domain Authority, full backlink graph, GBP Insights (calls/direction requests), Google review distribution, owner response rate. Enable DataForSEO MCP or share GBP Insights screenshots for Tier 1 depth.

## Quick site wiring completed this session

- Maps iframes → GBP CID embed  
- Directions CTA → GBP CID URL  
- Schema `geo` + `hasMap` + GBP `sameAs`  

Local preview: http://127.0.0.1:5173/ and http://127.0.0.1:5173/contact.html
