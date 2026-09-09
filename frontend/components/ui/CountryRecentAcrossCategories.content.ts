import { t, type Dictionary } from 'intlayer';

/**
 * "Latest {Category}" sub-headers inside the Recent Across Categories
 * section, plus the "See more" link shared by all four. Each category
 * phrase is translated as a whole (rather than interpolating a shared
 * "Latest" prefix onto an untranslated category name) so word order can be
 * correct per language — Luganda in particular puts the qualifier after
 * the noun ("Motors empya", not "empya Motors").
 *
 * TRANSLATION QUALITY NOTE: see intlayer.config.ts — en/lg/sw are all
 * locales the team can stand behind, not AI drafts pending review.
 */
const content = {
  key: 'recentAcrossCategoriesRow',
  content: {
    latestMotors: t({
      en: 'Latest Motors',
      lg: 'Emmotoka Empya',
      sw: 'Magari Mapya',
    }),
    latestElectronics: t({
      en: 'Latest Electronics',
      lg: 'Ebya Elekitulonike Ebipya',
      sw: 'Vifaa vya Elektroniki Vipya',
    }),
    latestProperty: t({
      en: 'Latest Property',
      lg: 'Ebintu by’Ettaka Ebipya',
      sw: 'Mali Mpya',
    }),
    latestFashion: t({
      en: 'Latest Fashion',
      lg: "Emisono Emipya",
      sw: 'Mitindo Mipya',
    }),
    seeMore: t({
      en: 'See more →',
      lg: 'Laba ebirala →',
      sw: 'Ona zaidi →',
    }),
  },
} satisfies Dictionary;

export default content;
