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
                    category, 
                    url
                )
            `)
            .order('published_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        const response = {
            generated_at: new Date().toISOString(),
            signals: {
                news: "GREEN|MARKET STABLE",
                future: "AI AGENTS DEPLOYING",
                trends: "AR GLASSES RISING",
                science: "QUANTUM BREAKTHROUGH",
                sports: "SEASON START",
                research: "MODEL V4 LEAKED"
            },
            items: (items || []).map((i: any) => {
                const feedInfo = Array.isArray(i.feeds) ? i.feeds[0] : i.feeds;
                
                // Safe Hostname Extraction
                let domain = 'news.source';
                if (feedInfo?.url) {
                    try { domain = new URL(feedInfo.url).hostname.replace('www.', ''); } 
                    catch (e) { domain = 'source.com'; }
                }

                return {
                    id: i.id,
                    title: i.title || 'Untitled',
                    url: i.url || '#',
                    // PASS THE UUID DOWN TO THE CLIENT
                    feed_id: feedInfo?.id || '00000000-0000-0000-0000-000000000000', 
                    source_name: feedInfo?.name || 'General News',
                    source_domain: domain,
                    category: feedInfo?.category || 'News', 
                    published_at: i.published_at,
                    image_url: i.image_url || null
                };
            })
        };

        return {
            statusCode: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*' // Good for debugging locally
            },
            body: JSON.stringify(response)
        };

    } catch (err: any) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};