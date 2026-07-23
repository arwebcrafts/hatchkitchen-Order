# Hatch Kitchen — Website

A 5-page marketing site (Home, Menu, Catering, About, Visit) built to sit in front of the existing
Toast ordering system. All "Order Online" buttons link out to the live Toast cart — this site does
not process orders itself, it exists to win the Google search and convert visitors into orders/catering leads.

## Language

This project uses **English only**. All site copy, code comments, commit messages, documentation, and contributor notes should be written in English.

## Brand correction (v2)
The first draft used an invented maroon/serif look that didn't match the real brand. This version
uses your actual logo files and colors instead:
- **Logo:** `images/logo-lockup.png` (icon + wordmark + "Feel-Good Fuel" script) and
  `images/logo-badge.png` (the circular badge, background removed) — both pulled directly from
  the files you shared, not redrawn.
- **Colors:** sampled directly from the logo — true black (`#121110`), egg-yolk yellow (`#F3C457`),
  peach (`#EFA862`), and a cream (`#F5F1E3`) that matches the badge's ring color. A small moss-green
  accent (`#4F6B3D`) nods to the real living wall in your dining room.
- **Type:** Poppins (bold, geometric — matches your wordmark) for headings, Allura for the script
  "Feel-Good Fuel" accents, Hanken Grotesk for body text, IBM Plex Mono for prices/labels.
- **Photography:** the interior shots, smoothie photos, and storefront sign you sent are now used
  directly (in `/images`) instead of hotlinked Toast photos or placeholders.

## Photography strategy (v3)
You sent two sets of images: real photos of the actual location, and a set of polished
AI-generated mood-board images. Both are used, but in different places, deliberately:
- **Real photos** (`storefront-sign.jpg`, `interior-wall-day.jpg`, `smoothie-hand.jpg`) are used
  on the **About** and **Visit** pages, where the photo is doing a "this is what to expect when
  you show up" job. Your mood-board images show a different building/interior design, so using
  them there would set the wrong expectation for someone trying to find the real place.
- **Mood-board crops** (`ai-hero.jpg`, `ai-wrap.jpg`, `ai-rotisserie.jpg`, `ai-salad.jpg`,
  `ai-catering.jpg`) are used for the homepage hero, the four menu-card thumbnails, the Family
  Meal spotlight, and the catering imagery — places where the photo's job is mood/appetite appeal
  rather than literal wayfinding.

If you'd rather have the mood-board look carried onto the About/Visit pages too (accepting that
it won't match the real building), or want real food photography to eventually replace the
mood-board crops, just say so — both are easy swaps.

## What's inside
```
index.html       Home
menu.html        Full menu, organized by category
catering.html    Catering menu + camp lunch program + inquiry CTA
about.html       Brand story, sourcing values, kosher certification
contact.html     Map, hours, FAQ (with FAQ schema for Google rich results)
css/styles.css   Full design system (colors, type, components)
js/main.js       Mobile nav, accordion, scroll behavior
images/          Logo files + real photography
favicon.png      Browser tab icon (cropped from your circular badge)
robots.txt       Tells search engines to crawl everything
sitemap.xml      Page list for Google Search Console
```

## Before you go live
1. **Domain.** Every page assumes `https://www.thehatchkitchen.com/` (canonical tags, Open Graph,
   JSON-LD, sitemap.xml). Find-and-replace `thehatchkitchen.com` if you deploy elsewhere.
2. **Map embed.** The Google Maps embed on the Visit page needs live internet to render — it'll
   work normally once hosted, it just can't preview inside a sandboxed environment.

## How to preview it
Unzip the folder and double-click `index.html` — it opens in your browser with full styling and
real images, since everything is now a local relative file.

## How to deploy it
Any static host works: upload the whole folder to Netlify, Vercel, GitHub Pages, or your existing
web host via FTP. Point `thehatchkitchen.com` at wherever you upload it.

## Still manual / needs a decision
- **Reviews:** The homepage shows review *counts* (Yelp, Instagram) rather than quoted reviews,
  since I didn't want to put words in real customers' mouths. Drop 3–4 real quotes into a
  `testimonial` block (CSS already exists in `styles.css`) once you've picked favorites.
- **Email signup / promos:** Not included — wire one up later via Mailchimp, Klaviyo, or Toast's
  own marketing tools if you want to start collecting emails for promos.
- **Geo-coordinates:** Schema markup intentionally omits exact latitude/longitude. Add them via
  Google Search Console or Google Business Profile once live.

