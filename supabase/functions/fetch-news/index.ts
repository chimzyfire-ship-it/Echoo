// Supabase Edge Function to fetch, parse, tag, and store news in Supabase Postgres.
// Deploy this to Supabase using: supabase functions deploy fetch-news
// Schedule it using pg_cron or an external ping tool (e.g. once an hour).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPPORTED_CANADA_CITIES } from "../_shared/location.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GNEWS_API_KEY = Deno.env.get("GNEWS_API_KEY") || ""; // Set this in Supabase env settings

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Heuristic keyword matcher for 15 onboarding vibe categories
function tagArticle(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  
  if (text.match(/club|dj|dancefloor|techno|house music|rave/)) return "Nightclubs & DJs";
  if (text.match(/hike|trail|mountain|camp|wilderness|backpacking/)) return "Hiking & Outdoor";
  if (text.match(/arcade|gaming|console|esports|retro game|nintendo|playstation/)) return "Gaming & Arcades";
  if (text.match(/speakeasy|cocktail|mixology|bar menu|whiskey|gin lounge/)) return "Speakeasies & Cocktails";
  if (text.match(/coffee|latte|espresso|cafe crawl|roastery|brew/)) return "Coffee Shop Crawls";
  if (text.match(/concert|festival|music festival|stadium tour|lineup/)) return "Concerts & Festivals";
  if (text.match(/beach|park|picnic|waterfront|sunset view/)) return "Beaches & Parks";
  if (text.match(/museum|exhibition|gallery|history|artifacts|archives/)) return "Museums & History";
  if (text.match(/jazz|acoustic|listening room|vinyl/)) return "Live music";
  if (text.match(/cinema|film|movie|screening|theater/)) return "Late-night cinema";
  if (text.match(/date spot|romantic|dinner for two|candlelit/)) return "Cozy date spots";
  if (text.match(/rooftop|skyline view|terrace/)) return "Rooftop bars";
  if (text.match(/art show|exhibit|painting|sculpture/)) return "Art & galleries";
  if (text.match(/street food|taco|food truck|bites|crawl/)) return "Street food crawls";
  if (text.match(/stadium|game tonight|match|cup|championship|arena/)) return "Sports";
  
  return "Lifestyle";
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!GNEWS_API_KEY) {
    return new Response(JSON.stringify({ error: "GNEWS_API_KEY is not configured in environment variables." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const cities = SUPPORTED_CANADA_CITIES.map((city) => city.name);
    let articlesIngested = 0;

    // 1. Fetch Global News (Entertainment/Sports categories)
    const globalUrl = `https://gnews.io/api/v4/top-headlines?category=entertainment&lang=en&country=ca&apikey=${GNEWS_API_KEY}`;
    const globalRes = await fetch(globalUrl);
    if (globalRes.ok) {
      const data = await globalRes.json();
      const articles = data.articles || [];
      for (const art of articles) {
        const tag = tagArticle(art.title, art.description);
        const { error } = await supabase
          .from("news")
          .upsert({
            title: art.title,
            tag: tag,
            image_url: art.image,
            city: "Global",
            published_at: art.publishedAt
          }, { onConflict: "published_at" });
        if (!error) articlesIngested++;
      }
    }

    // 2. Fetch City News
    for (const city of cities) {
      const cityUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(city + " Canada entertainment OR sports OR dining")}&lang=en&country=ca&apikey=${GNEWS_API_KEY}`;
      const cityRes = await fetch(cityUrl);
      if (cityRes.ok) {
        const data = await cityRes.json();
        const articles = data.articles || [];
        for (const art of articles) {
          const tag = tagArticle(art.title, art.description);
          const { error } = await supabase
            .from("news")
            .upsert({
              title: art.title,
              tag: tag,
              image_url: art.image,
              city: city,
              published_at: art.publishedAt
            }, { onConflict: "published_at" });
          if (!error) articlesIngested++;
        }
      }
    }

    // 3. Keep DB compact (delete records older than 3 days)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 3);
    const { error: deleteError } = await supabase
      .from("news")
      .delete()
      .lt("published_at", cutoffDate.toISOString());

    return new Response(JSON.stringify({
      success: true,
      articlesIngested,
      dbCleanup: !deleteError
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
