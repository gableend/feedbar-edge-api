import { Handler } from '@netlify/functions';
import { supabase } from '../../src/supabase';

export const handler: Handler = async (event, context) => {
    // 1. Fetch recent items from "General" feeds (Standard Feeds)
    const { data: items } = await supabase
        .from('items')
        .select(`
            id, title, url, published_at, image_url, category,
            feeds!inner(name, category, url)
        `)
        .order('published_at', { ascending: false })
        .limit(100);

    // 2. Construct the Response
    const response = {
        generated_at: new Date(),
        signals: {
            // Placeholder: Connect OpenAI here later
            news: "GREEN|MARKET STABLE",
            future: "AI AGENTS DEPLOYING",
            trends: "AR GLASSES RISING"
        },
        items: items?.map(i => ({
            id: i.id,
            title: i.title,
            url: i.url,
            source_name: (i.feeds as any).name,
            source_domain: new URL((i.feeds as any).url).hostname,
            category: (i.feeds as any).category || 'News',
            published_at: i.published_at,
            image_url: i.image_url
        })) || []
    };

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=600' // Cache for 10 mins
        },
        body: JSON.stringify(response)
    };
};
