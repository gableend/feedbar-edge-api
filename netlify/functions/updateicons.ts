import { Handler } from '@netlify/functions';
import { supabase } from '../../src/supabase';
import { getBestIcon } from '../../src/icons';

export const handler: Handler = async (event) => {
    const { data: feeds, error } = await supabase
        .from('feeds')
        .select('id, url')
        .is('icon_url', null)
        .limit(10); 

    if (error) return { statusCode: 500, body: error.message };
    if (!feeds || feeds.length === 0) {
        return { statusCode: 200, body: 'All icons updated!' };
    }

    let updatedCount = 0;
    for (const feed of feeds) {
        const icon = await getBestIcon(feed.url);
        if (icon) {
            await supabase
                .from('feeds')
                .update({ icon_url: icon })
                .eq('id', feed.id);
            updatedCount++;
        }
    }

    return { 
        statusCode: 200, 
        body: `Processed 10 feeds. ${updatedCount} icons found. Refresh to do more.` 
    };
};