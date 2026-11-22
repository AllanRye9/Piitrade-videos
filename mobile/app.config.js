// Extends app.json. When EXPO_PUBLIC_WEB_URL is set (your site's https origin), taps on
// https://<that host>/v/<id> links open the app on that video if it's installed
// (Android App Links + iOS Universal Links); otherwise the web permalink page is shown.
// The piitrade://v/<id> scheme works regardless.
module.exports = ({ config }) => {
  let host = null;
  try {
    const u = new URL(process.env.EXPO_PUBLIC_WEB_URL || '');
    if (u.protocol === 'https:') host = u.host;
  } catch {
    // not set / not https: skip universal links
  }
  if (!host) return config;
  return {
    ...config,
    ios: { ...config.ios, associatedDomains: [...(config.ios?.associatedDomains ?? []), `applinks:${host}`] },
    android: {
      ...config.android,
      intentFilters: [
        ...(config.android?.intentFilters ?? []),
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host, pathPrefix: '/v/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
  };
};
