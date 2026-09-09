import { t, type Dictionary } from 'intlayer';

/**
 * Flash Deals section header — shown identically in both the loading
 * skeleton and the loaded state in FlashDeals.tsx.
 *
 * TRANSLATION QUALITY NOTE: see intlayer.config.ts — en/lg/sw are all
 * locales the team can stand behind, not AI drafts pending review.
 */
const content = {
  key: 'flashDeals',
  content: {
    title: t({
      en: 'FLASH DEALS',
      lg: 'OFA ZA MANGU',
      sw: 'OFA ZA HARAKA',
    }),
    subtitleLine1: t({
      en: 'Limited-time drops from our authorized marketplace partners.',
      lg: 'Ebintu ebiweebwa mu kiseera kitono okuva mu bakolagana baffe abakkirizibwa.',
      sw: 'Bidhaa za muda mfupi kutoka kwa washirika wetu wa soko walioidhinishwa.',
    }),
    subtitleLine2: t({
      en: 'High-demand items from vetted vendors. These independent listings are admin-approved and available only until the timer hits zero.',
      lg: "Ebintu ebyetaagibwa ennyo okuva eri abatunzi abakebedwa. Ebiwandiiko bino ebyennyini bikkirizibwa omuyimirizi era bisangibwa okutuusa ekiseera lwe kiggwaawo.",
      sw: 'Bidhaa zenye mahitaji makubwa kutoka kwa wauzaji waliohakikiwa. Orodha hizi huru zimeidhinishwa na msimamizi na zinapatikana hadi muda utakapoisha.',
    }),
    viewAllShort: t({
      en: 'View All',
      lg: 'Laba Byonna',
      sw: 'Tazama Zote',
    }),
    viewAllLong: t({
      en: 'View All Live Deals',
      lg: 'Laba Ofa Zonna Ezikyaliwo',
      sw: 'Tazama Ofa Zote Zinazoendelea',
    }),
  },
} satisfies Dictionary;

export default content;
