import { Handler } from '@netlify/functions';
import { supabase } from '../../src/supabase';
import { fetchFeed } from '../../src/rss';

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    
    const { url } = JSON.parse(event.body || '{}');
    if (!url) return { statusCode: 400, body: 'Missing URL' };

    // 1. Check if exists
    const { data: existing } = await supabase.from('feeds').select('id, name').eq('url', url).single();
    if (existing) {
        return { statusCode: 200, body: JSON.stringify({ feed_id: existing.id, title: existing.name, is_new: false }) };
    }

    // 2. Validate & Fetch Title
    const items = await fetchFeed(url);
    if (!items) return { statusCode: 422, body: 'Invalid Feed' };
    
    // 3. Insert into DB
    const { data: newFeed } = await supabase
        .from('feeds')
        .insert({ url, name: 'New Discovery', category: 'Custom' }) // You can improve name extraction later
        .select()
        .single();

    return { 
        statusCode: 200, 
        body: JSON.stringify({ feed_id: newFeed.id, title: newFeed.name, is_new: true }) 
    };
};
