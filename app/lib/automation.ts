/*
 * Browsers that aren't the owner: a screenshot pass, a test run, a crawler. Their page views, clicks and opens would
 * make the Monday Jarvis review read dead ends that are only a script walking the site, so the usage tracker and
 * /api/usage drop them. Shared by the browser (components/UsageTracker.tsx) and the server; no imports on purpose.
 */
export const AUTOMATED_UA = /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Lighthouse|Selenium|WebDriver|\b(bot|crawler|spider)\b/i;
export const isAutomatedUA = (ua: string | null | undefined) => !!ua && AUTOMATED_UA.test(ua);
