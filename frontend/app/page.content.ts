import { t, type Dictionary } from 'intlayer';

/**
 * Homepage section chrome — titles, subtitles, and "view all" CTAs for the
 * three section blocks defined directly in app/page.tsx (Recent Across
 * Categories, Latest Collections, Featured Deal). Flash Deals has its own
 * content file — components/ui/FlashDeals.content.ts — since its header
 * lives inside that component, not here.
 *
 * TRANSLATION QUALITY NOTE: see intlayer.config.ts — en/lg/sw are all
 * locales the team can stand behind, not AI drafts pending review.
 */
const content = {
  key: 'homepage',
  content: {
    recentAcrossCategories: {
      title: t({
        en: 'Recent Across Categories',
        lg: 'Ebipya mu Bika Byonna',
        sw: 'Mapya Katika Kategoria Zote',
      }),
      subtitle: t({
        en: 'Latest items from key marketplaces — glance before you browse deeper',
        lg: "Ebintu ebipya okuva mu maaka ag'omukulu — tunula nga tonnagenda mu maaso",
        sw: 'Bidhaa mpya kutoka masoko makuu — angalia kabla hujaendelea kuvinjari',
      }),
      viewAll: t({
        en: 'View all listings',
        lg: 'Laba Ebiwandiiko Byonna',
        sw: 'Tazama orodha zote',
      }),
    },
    latestCollections: {
      title: t({
        en: 'Latest Collections',
        lg: 'Ebipya Ebirondeddwa',
        sw: 'Mkusanyiko wa Hivi Karibuni',
      }),
      subtitle: t({
        en: 'Latest curated items',
        lg: 'Ebintu ebipya ebirondeddwa',
        sw: 'Bidhaa mpya zilizoteuliwa',
      }),
      viewAll: t({
        en: 'View all',
        lg: 'Laba byonna',
        sw: 'Tazama zote',
      }),
      visit: t({
        en: 'Visit →',
        lg: 'Kyalira →',
        sw: 'Tembelea →',
      }),
    },
    featuredDeal: {
      // The ✦ glyph is rendered separately in the JSX so it isn't baked
      // into the translated string — decorative marks shouldn't force a
      // translator to also carry unrelated typography.
      title: t({
        en: 'FEATURED DEAL',
        lg: 'OFA ENJAWULO',
        sw: 'OFA MAALUM',
      }),
      badge: t({
        en: 'HANDPICKED FOR YOU',
        lg: 'ZIRONDEDDWA GGWE',
        sw: 'ZILIZOCHAGULIWA KWA AJILI YAKO',
      }),
      subtitle: t({
        en: 'Our premier choice for today. Standout items selected by our experts for exceptional quality and value.',
        lg: "Okulonda kwaffe okusinga leero. Ebintu ebirabika ennyo ebirondeddwa abakugu baffe olw'omutindo n'omuwendo ogw'enjawulo.",
        sw: 'Chaguo letu bora kwa leo. Bidhaa bora zilizoteuliwa na wataalamu wetu kwa ubora na thamani ya kipekee.',
      }),
      viewAllDeals: t({
        en: 'View All Deals',
        lg: 'Laba Ofa Zonna',
        sw: 'Tazama Ofa Zote',
      }),
    },
  },
} satisfies Dictionary;

export default content;
