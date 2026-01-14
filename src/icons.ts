import axios from 'axios';
import * as cheerio from 'cheerio';

export async function getBestIcon(siteUrl: string): Promise<string | null> {
    try {
        const domain = new URL(siteUrl).origin;
        const response = await axios.get(domain, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) FeedBar/1.0' }
        });

        const $ = cheerio.load(response.data);
        let iconUrl: string | null = null;

        const appleIcon = $('link[rel="apple-touch-icon"]').attr('href') || 
                          $('link[rel="apple-touch-icon-precomposed"]').attr('href');
        
        if (appleIcon) iconUrl = appleIcon;

        if (!iconUrl) {
            iconUrl = $('link[rel="icon"]').attr('href') || 
                      $('link[rel="shortcut icon"]').attr('href');
        }

        if (iconUrl) {
            if (iconUrl.startsWith('//')) {
                iconUrl = 'https:' + iconUrl;
            } else if (iconUrl.startsWith('/')) {
                iconUrl = domain + iconUrl;
            } else if (!iconUrl.startsWith('http')) {
                iconUrl = domain + '/' + iconUrl;
            }
            return iconUrl;
        }

        return `${domain}/favicon.ico`;
    } catch (error) {
        try {
            return `${new URL(siteUrl).origin}/favicon.ico`;
        } catch {
            return null;
        }
    }
}