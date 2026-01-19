import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';

// --------------------------------------------------------------------------
// CONFIGURATION
// --------------------------------------------------------------------------
const RETENTION_DAYS = 90; // Feeds older than this are considered "Stale" and disabled
// --------------------------------------------------------------------------

const parser = new Parser({
    timeout: 5000, 
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
    }
});

const supabase = createClient(
    process.env.SUPABASE_URL || '', 
    process.env.SUPABASE_KEY || ''
);

const isFatalError = (err: any) => {
    const msg = (err.message || String(err)).toLowerCase();
    return msg.includes('status code 404') || 
           msg.includes('status code 403') || 
           msg.includes('status code 410') ||
           msg.includes('non-whitespace before first tag') ||
           msg.includes('unexpected close tag') ||
           msg.includes('invalid character');
};

export const handler = schedule('*/10 * * * *', async (event) => {
    console.log(`⚡️ Ingest started (${RETENTION_DAYS}-day strict policy)...`);
    
    // Calculate the Cutoff Date once
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    // 1. Get 10 feeds
    const { data: feeds } = await supabase
        .from('feeds')
        .select('id, url, name') 
        .eq('is_active', true)
        .order('last_fetched_at', { ascending: true, nullsFirst: true }) 
        .limit(10); 
        
    if (!feeds?.length) return { statusCode: 200 };

    console.log(`Processing Batch of ${feeds.length} feeds...`);

    // 2. Process Feeds
    await Promise.all(feeds.map(async (feed) => {
        try {
            const feedData = await parser.parseURL(feed.url);
            const allItems = feedData.items || [];
            
            // ---------------------------------------------------------
            // THE "STALE CHECK": Filter out old items immediately
            // ---------------------------------------------------------
            const recentItems = allItems.filter((i: any) => {
                const dateStr = i.isoDate || i.pubDate || new Date().toISOString();
                const itemDate = new Date(dateStr);
                return itemDate >= cutoffDate;
            });

            // --- SUCCESS PATH (Has Recent Items) ---
            if (recentItems.length > 0) {
                const rows = recentItems.map((i: any) => ({
                    feed_id: feed.id,
                    title: i.title || 'Untitled',
                    url: i.link || i.enclosure?.url || i.guid, 
                    published_at: i.isoDate ? new Date(i.isoDate).toISOString() : 
                                  (i.pubDate ? new Date(i.pubDate).toISOString() : new Date().toISOString()),
                    summary: (i.contentSnippet || i.content || i.summary || '').substring(0, 300),
                    image_url: i.enclosure?.url || i.itunes?.image || null
                }));

                const newestDate = new Date(Math.max(...rows.map((r: any) => new Date(r.published_at).getTime())));
                console.log(`✅ [${feed.name}]: ${recentItems.length} recent items. Newest: ${newestDate.toISOString().split('T')[0]}`);

                const validRows = rows.filter((r: any) => r.url && r.title);
                if (validRows.length > 0) {
                    await supabase
                        .from('items')
                        .upsert(validRows, { onConflict: 'url', ignoreDuplicates: true });
                }

                await supabase.from('feeds')
                    .update({ last_fetched_at: new Date().toISOString() })
                    .eq('id', feed.id);
            } 
            // --- FAILURE PATH (Empty OR Stale) ---
            else {
                const reason = allItems.length === 0 ? "EMPTY (0 items)" : `STALE (No items < ${RETENTION_DAYS} days)`;
                console.warn(`💀 KILL: Disabling ${feed.name} -> ${reason}`);
                
                // Log to Triage
                await supabase.from('feed_errors').insert({
                    feed_id: feed.id, 
                    feed_name: feed.name, 
                    feed_url: feed.url,
                    error_code: allItems.length === 0 ? 'NO_ITEMS' : 'STALE', 
                    error_message: `Feed disabled: ${reason}`
                });

                // Disable Feed
                await supabase.from('feeds')
                    .update({ 
                        is_active: false, 
                        last_fetched_at: new Date().toISOString() 
                    })
                    .eq('id', feed.id);
            }

        } catch (err: any) {
            // --- ERROR PATH ---
            const errorMsg = err.message || String(err);
            
            if (isFatalError(err)) {
                console.error(`💀 FATAL: Disabling ${feed.name} (${errorMsg.substring(0, 40)})`);
                
                await supabase.from('feed_errors').insert({
                    feed_id: feed.id, feed_name: feed.name, feed_url: feed.url,
                    error_code: 'FATAL', error_message: errorMsg
                });

                await supabase.from('feeds')
                    .update({ is_active: false, last_fetched_at: new Date().toISOString() })
                    .eq('id', feed.id);
            } else {
                console.log(`⚠️ Retry: ${feed.name} (${errorMsg.substring(0, 40)})`);
                 await supabase.from('feeds')
                    .update({ last_fetched_at: new Date().toISOString() })
                    .eq('id', feed.id);
            }
        }
    }));

    // 3. CLEANUP (Aligns with Retention Policy)
    const { count } = await supabase
        .from('items')
        .delete({ count: 'exact' })
        .lt('published_at', cutoffDate.toISOString());

    if (count && count > 0) {
        console.log(`🧹 Cleanup: Removed ${count} items older than ${RETENTION_DAYS} days.`);
    }
    
    console.log("✅ Batch complete.");
    return { statusCode: 200 };
});