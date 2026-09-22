module.exports = ({ config }) => {
  const androidMapsKey = process.env.ANDROID_GOOGLE_MAPS_API_KEY || config.android?.config?.googleMaps?.apiKey;
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  return {
    ...config,
    // Expo's built-in Android config plugin writes this manifest key.
    // iOS uses Apple Maps and needs no Google Maps SDK configuration.
    android: {
      ...config.android,
      config: {
        ...config.android?.config,
        ...(androidMapsKey ? { googleMaps: { apiKey: androidMapsKey } } : {}),
      },
    },
    extra: {
      ...config.extra,
      androidMapsConfigured: Boolean(androidMapsKey),
      ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}),
    },
  };
};
