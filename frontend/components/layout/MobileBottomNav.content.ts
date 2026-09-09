import { t, type Dictionary } from 'intlayer';

/**
 * TRANSLATION QUALITY NOTE: `en`, `lg` (Luganda), and `sw` (Kiswahili) are
 * all reasonably reliable — this app previously also shipped `ach`, `nyn`,
 * `lam`, and `teo` (Acoli/Runyankole/Lango/Ateso) as AI-best-effort drafts
 * for these same low-resource languages, but they were dropped rather than
 * left half-finished; see intlayer.config.ts for the reasoning. Every
 * locale below is one the team can stand behind, not a draft — though as
 * with any machine translation, a native-speaker pass before high-stakes
 * use (e.g. legal/payment copy) is still worthwhile.
 */
const content = {
  key: 'mobileBottomNav',
  content: {
    home: t({
      en: 'Home',
      lg: 'Awaka',
      sw: 'Nyumbani',
    }),
    browse: t({
      en: 'Browse',
      lg: 'Noonya',
      sw: 'Vinjari',
    }),
    sell: t({
      en: 'Sell',
      lg: 'Tunda',
      sw: 'Uza',
    }),
    account: t({
      en: 'Account',
      lg: 'Akawunti',
      sw: 'Akaunti',
    }),
  },
} satisfies Dictionary;

export default content;
