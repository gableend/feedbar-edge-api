import Parser from 'rss-parser';

const parser = new Parser({
    timeout: 5000,
    headers: { 'User-Agent': 'FeedBar-Server/1.0 (+https://feedbar.app)' }
});

export interface CleanItem {
    title: string;
    url: string;
    published_at: Date;
    author: string | null;
    summary: string | null;
    image_url: string | null;
}

export async function fetchFeed(url: string): Promise<CleanItem[] | null> {
    try {
        const feed = await parser.parseURL(url);
        return feed.items.map(item => ({
            title: item.title || 'Untitled',
            url: item.link || '',
            published_at: item.isoDate ? new Date(item.isoDate) : new Date(),
            author: item.creator || item.author || null,
            summary: item.contentSnippet || null,
            image_url: item.enclosure?.url || null
        })).filter(i => i.url !== '');
    } catch (e) {
        console.error(`RSS Fail [${url}]:`, e);
        return null;
    }
}
