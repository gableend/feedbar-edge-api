// netlify/functions/manifest.ts

import { Handler } from '@netlify/functions';
import { supabase } from '../../src/supabase';

export const handler: Handler = async (event, context) => {
    try {
        const { data: items, error } = await supabase
            .from('items')
            .select(`
                id, 
                title, 
                url, 
                published_at, 
                image_url, 
                feeds (
                    id,
                    name, 
                    url,
                    // LINK TO NEW TABLE
                    categories (
                        name
                    )
                )
            `)
            .order('published_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        const response = {
            generated_at: new Date().toISOString(),
            // ... (keep your signals logic) ...
            items: (items || []).map((i: any) => {
                const feedInfo = Array.isArray(i.feeds) ? i.feeds[0] : i.feeds;
                
                // HOSTNAME EXTRACTION
                let domain = 'news.source';
                if (feedInfo?.url) {
                    try { domain = new URL(feedInfo.url).hostname.replace('www.', ''); } 
                    catch (e) { domain = 'source.com'; }
                }

                // CATEGORY PRIORITY:
                // 1. DB Relation (The Truth)
                // 2. Client Normalizer (The Fallback)
                // Note: We send the DB name if it exists, otherwise null so Client Normalizer takes over
                const dbCategory = feedInfo?.categories?.name || null;

                return {
                    id: i.id,
                    title: i.title || 'Untitled',
                    url: i.url || '#',
                    feed_id: feedInfo?.id || '00000000-0000-0000-0000-000000000000', 
                    source_name: feedInfo?.name || 'General News',
                    source_domain: domain,
                    category: dbCategory, // <--- SENDING THE REAL DB CATEGORY NOW
                    published_at: i.published_at,
                    image_url: i.image_url || null
                };
            })
        };

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response)
        };

    } catch (err: any) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};