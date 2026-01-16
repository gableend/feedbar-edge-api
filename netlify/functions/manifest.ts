import { Handler } from '@netlify/functions';
import { supabase } from '../../src/supabase';

export const handler: Handler = async (event, context) => {
    try {
        // 1. Fetch recent items joined with their parent feed data
        const { data: items, error } = await supabase
            .from('items')
            .select(`
                id, 
                title, 
                url, 
                published_at, 
                image_url, 
                feeds (
                    name, 
                    category, 
                    url
                )
            `)
            .order('published_at', { ascending: false })
            .limit(100);

        if (error) {
            console.error("Supabase Query Error:", error);
            throw error;
        }

        // 2. Construct the Flattened Response
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
            items: (items || []).map(i => {
                // Handle cases where Supabase might return feeds as a single object or an array
                const feedInfo = Array.isArray(i.feeds) ? i.feeds[0] : i.feeds;
                
                // Safe extraction of the source domain for the ticker UI
                let domain = 'news.source';
                if (feedInfo?.url) {
                    try {
                        domain = new URL(feedInfo.url).hostname.replace('www.', '');
                    } catch (e) {
                        domain = 'source.com';
                    }
                }

                // Flattening: mapping the 'feeds' table data into the item object
                return {
                    id: i.id,
                    title: i.title || 'Untitled Article',
                    url: i.url || '#',
                    source_name: feedInfo?.name || 'General News',
                    source_domain: domain,
                    // Pulling the category from the joined feeds table
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
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=60' // Fast refresh for testing
            },
            body: JSON.stringify(response)
        };

    } catch (err: any) {
        console.error("Manifest Handler Error:", err.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};