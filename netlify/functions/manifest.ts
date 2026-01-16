import { Handler } from '@netlify/functions';
import { supabase } from '../../src/supabase';

export const handler: Handler = async (event, context) => {
    try {
        // 1. Fetch recent items from "items" table
        // We removed !inner to ensure items show up even if the feed relation is loose
        const { data: items, error } = await supabase
            .from('items')
            .select(`
                id, 
                title, 
                url, 
                published_at, 
                image_url, 
                category,
                feeds (name, category, url)
            `)
            .order('published_at', { ascending: false })
            .limit(100);

        if (error) {
            console.error("Supabase Query Error:", error);
            throw error;
        }

        // 2. Construct the Response with Defensive Mapping
        const response = {
            generated_at: new Date().toISOString(),
            signals: {
                news: "GREEN|MARKET STABLE",
                future: "AI AGENTS DEPLOYING",
                trends: "AR GLASSES RISING",
                science: "QUANTUM BREAKTHROUGH", // Added placeholders for your other orbs
                sports: "SEASON START",
                research: "MODEL V4 LEAKED"
            },
            items: (items || []).map(i => {
                // Supabase joins can return an object or a single-item array
                const feedInfo = Array.isArray(i.feeds) ? i.feeds[0] : i.feeds;
                
                // Safe Hostname Extraction
                let domain = 'news.source';
                if (feedInfo?.url) {
                    try {
                        domain = new URL(feedInfo.url).hostname.replace('www.', '');
                    } catch (e) {
                        domain = 'source.com';
                    }
                }

                return {
                    id: i.id,
                    title: i.title || 'Untitled Article',
                    url: i.url || '#',
                    source_name: feedInfo?.name || 'General News',
                    source_domain: domain,
                    category: i.category || feedInfo?.category || 'News',
                    published_at: i.published_at,
                    image_url: i.image_url || null
                };
            })
        };

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*', // Useful for local debugging
                'Cache-Control': 'public, max-age=60' // Reduced to 1 min for testing
            },
            body: JSON.stringify(response)
        };

    } catch (err: any) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};