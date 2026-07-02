(function () {
  const DAYPARTS = [
    {
      id: "early",
      start: 4,
      end: 7,
      label: "early today",
      cta: "Find an early plan",
      query: "calm early activities near me",
    },
    {
      id: "morning",
      start: 7,
      end: 11,
      label: "this morning",
      cta: "Plan my morning",
      query: "best morning activities near me",
    },
    {
      id: "midday",
      start: 11,
      end: 14,
      label: "around lunch",
      cta: "Plan around lunch",
      query: "lunch and nearby things to do",
    },
    {
      id: "afternoon",
      start: 14,
      end: 17,
      label: "this afternoon",
      cta: "Plan my afternoon",
      query: "best afternoon activities near me",
    },
    {
      id: "after_work",
      start: 17,
      end: 20,
      label: "after work",
      cta: "Plan after work",
      query: "after work food culture and activities",
    },
    {
      id: "evening",
      start: 20,
      end: 23,
      label: "this evening",
      cta: "Plan my evening",
      query: "best evening plan near me",
    },
    {
      id: "late",
      start: 23,
      end: 28,
      label: "late today",
      cta: "Find late options",
      query: "late food music and activities near me",
    },
  ];

  function localNow(timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || undefined,
      weekday: "long",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    const dayName =
      parts.find((part) => part.type === "weekday")?.value || "Today";
    const hour = Number(
      parts.find((part) => part.type === "hour")?.value ||
        new Date().getHours(),
    );
    return { dayName, hour };
  }

  function getDaypart(hour) {
    const normalized = hour < 4 ? hour + 24 : hour;
    return (
      DAYPARTS.find(
        (part) => normalized >= part.start && normalized < part.end,
      ) || DAYPARTS[3]
    );
  }

  function getActivityContext(options) {
    const timezone = options?.timezone;
    const city = options?.city || "your area";
    const now = localNow(timezone);
    const daypart = getDaypart(now.hour);
    return {
      city,
      timezone,
      dayName: now.dayName,
      localHour: now.hour,
      daypart: daypart.id,
      label: daypart.label,
      planCta: daypart.cta,
      searchPlaceholder: `What sounds good ${daypart.label}?`,
      defaultQuery: `${daypart.query} in ${city}`,
      planQuery: `${daypart.query} in ${city}`,
      subtleStatus: `${city} · ${daypart.label}`,
    };
  }

  window.EchooActivityContext = {
    DAYPARTS,
    getActivityContext,
  };
})();
