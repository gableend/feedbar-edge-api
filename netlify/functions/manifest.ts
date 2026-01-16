import { createClient } from '@supabase/supabase-js'

export const handler = async (event: any, context: any) => {
    const supabaseUrl = process.env.SUPABASE_URL || ''
    const supabaseKey = process.env.SUPABASE_KEY || ''
    const supabase = createClient(supabaseUrl, supabaseKey)

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
                    category
                )
            `)
            .order('published_at', { ascending: false })
            .limit(10000); // ✅ UPDATED: Covers your full DB (approx 4500 items)

        if (error) throw error;

        const response = {
            generated_at: new Date().toISOString(),
            signals: {}, 
            items: (items || []).map((i: any) => {
                const feedInfo = Array.isArray(i.feeds) ? i.feeds[0] : i.feeds;
                
                let domain = 'news.source';
                if (feedInfo?.url) {
                    try { domain = new URL(feedInfo.url).hostname.replace('www.', ''); } 
                    catch (e) { domain = 'source.com'; }
                }

                const dbCategory = feedInfo?.category || 'News';

                return {
                    id: i.id,
                    title: i.title || 'Untitled',
                    url: i.url || '#',
                    feed_id: feedInfo?.id || '00000000-0000-0000-0000-000000000000', 
                    source_name: feedInfo?.name || 'General News',
                    source_domain: domain,
                    category: dbCategory,
                    published_at: i.published_at,
                    image_url: i.image_url || null
                };
            })
        };

        return {
            statusCode: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(response)
        };

    } catch (err: any) {
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: err.message || String(err) }) 
        };
    }
};