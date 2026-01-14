import { Handler } from '@netlify/functions';
import { supabase } from '../../src/supabase';

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405 };
    const { feed_ids } = JSON.parse(event.body || '{}');
    
    if (!feed_ids || !feed_ids.length) return { statusCode: 200, body: '[]' };

    const { data: items } = await supabase
        .from('items')
        .select('title, url, published_at, image_url, feeds(name, url)')
        .in('feed_id', feed_ids)
        .order('published_at', { ascending: false })
        .limit(50);

    // Map to ManifestItem structure (Same as manifest.ts)
    const mapped = items?.map(i => ({
        title: i.title,
        url: i.url,
        source_name: (i.feeds as any).name,
        source_domain: new URL((i.feeds as any).url).hostname,
        category: 'Custom',
        published_at: i.published_at,
        image_url: i.image_url
    })) || [];

    return {
        statusCode: 200,
        body: JSON.stringify(mapped)
    };
};
