import Parser from 'rss-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createServiceClient } from './lib/supabase';

const supabase = createServiceClient();

type CustomItem = { 
    author?: string; 
    creator?: string; 
    mediaContent?: { $: { url: string } };
    mediaThumbnail?: { $: { url: string } };
    itemImage?: { url: string };
    contentEncoded?: string;
};
type CustomFeed = {};

export interface CleanItem {
    title: string;
    url: string;
    published_at: Date;
    author: string | null;
    summary: string | null;
    image_url: string | null;
}

const parser: Parser<CustomFeed, CustomItem> = new Parser({
    timeout: 5000,
    headers: { 'User-Agent': 'FeedBar-Server/1.0 (+https://feedbar.app)' },
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['media:thumbnail', 'mediaThumbnail'],
            ['image', 'itemImage'],
            ['content:encoded', 'contentEncoded'],
            ['author', 'author']
        ],
    }
});

async function getOGImage(url: string): Promise<string | null> {
    try {
        const { data } = await axios.get(url, { 
            timeout: 2500, // Slightly tighter timeout
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } 
        });
        const $ = cheerio.load(data);
        return $('meta[property="og:image"]').attr('content') || 
               $('meta[name="twitter:image"]').attr('content') || 
               null;
    } catch {
        return null;
    }
}

export interface FetchedFeed {
    title: string | null;
    items: CleanItem[];
}

export async function fetchFeed(url: string): Promise<FetchedFeed | null> {
    try {
        const feed = await parser.parseURL(url);
        const feedTitle = feed.title?.trim() || null;
        const cleanedItems: CleanItem[] = [];

        // LIMIT: Only process the top 5 items per feed to save time
        const topItems = feed.items.slice(0, 5);

        // OPTIMIZATION: Get list of URLs we already have in Supabase
        const itemUrls = topItems.map(i => i.link).filter((l): l is string => !!l);
        const { data: existingItems } = await supabase
            .from('items')
            .select('url')
            .in('url', itemUrls);
        
        const existingUrls = new Set(existingItems?.map(i => i.url) || []);

        for (const item of topItems) {
            if (!item.link) continue;

            // SKIP: If we already have this URL, don't waste time scraping
            if (existingUrls.has(item.link)) continue;

            // Priority 1: Fast RSS Tags
            let image = item.enclosure?.url || null;
            if (!image && item.mediaContent) image = item.mediaContent.$.url;
            if (!image && item.mediaThumbnail) image = item.mediaThumbnail.$.url;
            if (!image && item.itemImage) image = item.itemImage.url;

            // Priority 2: Deep OG Scraper (Only if needed and item is new)
            if (!image) {
                image = await getOGImage(item.link);
            }

            cleanedItems.push({
                title: item.title || 'Untitled',
                url: item.link,
                published_at: item.isoDate ? new Date(item.isoDate) : new Date(),
                author: item.creator || item.author || null,
                summary: item.contentSnippet || item.content || item.contentEncoded || null,
                image_url: image
            });
        }
        
        return { title: feedTitle, items: cleanedItems };
    } catch (e) {
        console.error(`RSS Fail [${url}]:`, e);
        return null;
    }
}