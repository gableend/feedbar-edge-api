import { schedule } from '@netlify/functions';
import { supabase } from '../../src/supabase';
import { fetchFeed } from '../../src/rss';

// Run every 10 mins
const handler = schedule('*/10 * * * *', async (event) => {
    console.log("⚡️ Ingest started...");
    
    // 1. Get Active Feeds
    const { data: feeds } = await supabase
        .from('feeds')
        .select('id, url')
        .eq('is_active', true);
        
    if (!feeds?.length) return { statusCode: 200 };

    // 2. Fetch & Update DB
    await Promise.allSettled(feeds.map(async (feed) => {
        const items = await fetchFeed(feed.url);
        if (!items?.length) return;

        const rows = items.map(i => ({
            feed_id: feed.id,
            title: i.title,
            url: i.url,
            published_at: i.published_at.toISOString(),
            author: i.author,
            summary: i.summary,
            image_url: i.image_url
        }));

        // Upsert (Insert if new, ignore if exists based on URL)
        await supabase.from('items').upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
        
        // Update timestamp
        await supabase.from('feeds').update({ last_fetched_at: new Date() }).eq('id', feed.id);
    }));

    return { statusCode: 200 };
});

export { handler };
