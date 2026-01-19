import { createClient } from '@supabase/supabase-js'

export const handler = async (event: any, context: any) => {
    const supabaseUrl = process.env.SUPABASE_URL || ''
    const supabaseKey = process.env.SUPABASE_KEY || ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    try {
        const [itemsResult, sourcesResult] = await Promise.all([
            // 1. ITEMS QUERY
            supabase
                .from('v_manifest') 
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
                .limit(5000), 

            // 2. SOURCES QUERY
            supabase
                .from('feeds')
                .select('id, name, url, category, icon_url') // 👈 ADDED icon_url HERE
                .eq('is_active', true) 
                .order('name', { ascending: true })
        ]);

        if (itemsResult.error) throw itemsResult.error;
        if (sourcesResult.error) throw sourcesResult.error;

        const itemsData = itemsResult.data || [];
        const sourcesData = sourcesResult.data || [];

        const getDomain = (url: string) => {
            try { return new URL(url).hostname.replace('www.', ''); } 
            catch (e) { return 'source.com'; }
        };

        const response = {
            generated_at: new Date().toISOString(),
            
            sources: sourcesData.map((s: any) => ({
                id: s.id,
                name: s.name,
                domain: getDomain(s.url),
                category: s.category || 'General',
                url: s.url,
                icon_url: s.icon_url, // 👈 ADDED icon_url HERE
                default_enabled: true 
            })),

            items: itemsData.map((i: any) => {
                const feedInfo = Array.isArray(i.feeds) ? i.feeds[0] : i.feeds;
                
                return {
                    id: i.id,
                    title: i.title || 'Untitled',
                    url: i.url || '#',
                    feed_id: feedInfo?.id || '00000000-0000-0000-0000-000000000000', 
                    source_name: feedInfo?.name || 'General News',
                    source_domain: feedInfo?.url ? getDomain(feedInfo.url) : 'news.source',
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