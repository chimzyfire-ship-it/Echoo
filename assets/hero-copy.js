(function () {
  const banks = {
    home: {
      morning: [
        ["Your day called. It wants better plans.", "Coffee first. Chaos later. Echoo has ideas."],
        ["Ontario is awake. Barely. We found the fun part.", "Start soft, end smugly pleased with yourself."],
        ["Plans before your second coffee? Brave.", "We will keep it simple and make you look organized."],
      ],
      afternoon: [
        ["The day is still saveable.", "A good plan can rescue even the weird middle hours."],
        ["Do something worth changing shoes for.", "Echoo finds the place, the mood, and the next move."],
        ["Your couch has had enough of you.", "Ontario has better lighting and better snacks."],
      ],
      evening: [
        ["Tonight does not need a committee.", "One good plan. Fewer group chat negotiations."],
        ["Go where the night gets interesting.", "Food, rooms, shows, and soft landings nearby."],
        ["Main character plans, minimal admin.", "Echoo handles the where so you can handle the outfit."],
      ],
      late: [
        ["The night is still open.", "Late food, live rooms, and places that understand the assignment."],
        ["Too late for boring. Perfect time for Echoo.", "We found the moves that still make sense."],
        ["If you are awake, make it cinematic.", "Ontario after dark, without the endless scrolling."],
      ],
    },
    discover: {
      morning: [
        ["Find the day’s good part.", "Live Ontario picks for breakfast brains and real plans."],
        ["Less scrolling. More leaving the house.", "Fresh places and events, matched to the hour."],
      ],
      afternoon: [
        ["What is worth doing right now?", "Live picks without the giant menu energy."],
        ["Ontario has options. We made them behave.", "A calm feed of places, shows, and easy starts."],
      ],
      evening: [
        ["The night has entered the chat.", "Live plans, good rooms, and fewer bad maybes."],
        ["Pick a lane. Make it lovely.", "Shows, tables, and places that work tonight."],
      ],
      late: [
        ["Still out? Respect.", "Late picks that do not feel like leftovers."],
        ["Night mode, but for your life.", "Open places, live rooms, and soft landings."],
      ],
    },
    music: {
      morning: [
        ["Save your ears something nice.", "Live rooms and listening spots for later-you."],
        ["Morning playlist. Evening plot twist.", "Find a room with sound worth dressing up for."],
      ],
      afternoon: [
        ["Your headphones need competition.", "Live music, listening bars, and rooms with real pulse."],
        ["Find the room before the room finds TikTok.", "Good sound, close lights, clean plans."],
      ],
      evening: [
        ["Go where the speakers are honest.", "Live sets and listening rooms with a pulse."],
        ["Tonight deserves a soundtrack.", "Find the room, then let the night behave badly in a tasteful way."],
      ],
      late: [
        ["Bass after bedtime.", "Late rooms, soft lights, and the kind of sound you feel first."],
        ["The playlist can come outside now.", "Live music still moving around Ontario."],
      ],
    },
    dates: {
      morning: [
        ["Romance, but make it low pressure.", "Coffee walks and gentle plans for charming humans."],
        ["A date before overthinking ruins it.", "Simple places, pretty routes, easy exits."],
      ],
      afternoon: [
        ["Cute plans. Zero spreadsheet energy.", "Tables, galleries, walks, and soft landings."],
        ["Make the plan feel effortless.", "We found the places. You bring the eye contact."],
      ],
      evening: [
        ["Dinner, then the good part.", "Date plans with room to breathe and somewhere nice after."],
        ["Less ‘wyd’, more ‘I booked us something.’", "A few polished moves for tonight."],
      ],
      late: [
        ["Keep talking somewhere better.", "Dessert, wine bars, and late quiet corners."],
        ["The date is not over if dessert exists.", "Find a second stop that feels intentional."],
      ],
    },
    food: {
      morning: [
        ["Breakfast deserves a tiny round of applause.", "Bakeries, coffee, and places worth leaving early for."],
        ["Your stomach has entered the planning meeting.", "Fresh food picks without the endless list."],
      ],
      afternoon: [
        ["Eat something that fixes your mood.", "Good tables, quick bites, and snack logic nearby."],
        ["Lunch can absolutely be the event.", "Find food that makes the day less ordinary."],
      ],
      evening: [
        ["A table can change the whole night.", "Restaurants, small plates, and after-dinner moves."],
        ["Dinner plans without the panic scroll.", "Live food picks that look and taste like a yes."],
      ],
      late: [
        ["Late bites are a love language.", "Dessert, kitchens still open, and emergency fries with dignity."],
        ["The night said dessert.", "Find the sweet second stop before everyone gets vague."],
      ],
    },
    films: {
      morning: [
        ["Plan the popcorn before the plot twist.", "Trailers and screenings for later-you."],
        ["Your future self wants a movie night.", "Find the film, then find somewhere good after."],
      ],
      afternoon: [
        ["A cinema plan is a personality.", "Trailers worth building the night around."],
        ["Two hours in the dark? Therapeutic.", "Find the film that makes leaving home easy."],
      ],
      evening: [
        ["Tonight looks better on a big screen.", "Trailers, screenings, and post-film dessert energy."],
        ["Pick the movie. Keep the night.", "Films that deserve somewhere good after."],
      ],
      late: [
        ["Late show, main character behavior.", "Trailers for nights that should not end at dinner."],
        ["The credits are not the plan’s ending.", "Find a film, then find the after."],
      ],
    },
  };

  function ontarioPart() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 23) return "evening";
    return "late";
  }

  function pick(page, part) {
    const set = banks[page] || banks.home;
    const options = set[part] || set.afternoon || banks.home.afternoon;
    const key = `echoo_hero_spin_${page}`;
    const next = (Number(localStorage.getItem(key) || "0") + 1) % options.length;
    localStorage.setItem(key, String(next));
    return options[next];
  }

  function applyHeroCopy() {
    document.querySelectorAll("[data-echoo-hero]").forEach((hero) => {
      const page = hero.dataset.echooHero || "home";
      const [title, copy] = pick(page, ontarioPart());
      const titleEl = hero.querySelector("[data-echoo-hero-title]");
      const copyEl = hero.querySelector("[data-echoo-hero-copy]");
      if (titleEl) titleEl.textContent = title;
      if (copyEl) copyEl.textContent = copy;
    });
  }

  window.EchooHeroCopy = { apply: applyHeroCopy };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyHeroCopy, { once: true });
  } else {
    applyHeroCopy();
  }
})();
