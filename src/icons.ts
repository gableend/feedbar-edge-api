import { FaviconExtractor } from "@iocium/favicon-extractor";

export async function getBestIcon(siteUrl: string): Promise<string | null> {
    try {
        const extractor = new FaviconExtractor();
        // The library returns string[] (Array of URLs)
        const icons: string[] = await extractor.fetchAndExtract(siteUrl);
        
        if (!icons || icons.length === 0) {
            const domain = new URL(siteUrl).origin;
            return `${domain}/favicon.ico`;
        }

        // 1. Prioritize Apple Touch Icons (usually high-res)
        const appleIcon = icons.find(url => 
            url.toLowerCase().includes('apple-touch-icon') || 
            url.toLowerCase().includes('atouch')
        );
        if (appleIcon) return appleIcon;

        // 2. Look for PNGs (usually better than .ico)
        const pngIcon = icons.find(url => url.toLowerCase().includes('.png'));
        if (pngIcon) return pngIcon;

        // 3. Fallback to the first one found
        return icons[0];
    } catch (error) {
        console.error(`Icon fetch failed for ${siteUrl}:`, error);
        return null;
    }
}