/**
 * Útvonaltervező a logisztikus felülethez.
 * ---------------------------------------------------------------
 * FONTOS KORLÁT: nincs a rendszerhez kötve valódi útvonaltervező API (pl. Google Directions) —
 * ahhoz fizetős API-kulcs kellene. Emiatt az utazási időt a két pont közötti légvonalbeli
 * távolságból (haversine-képlet) és egy átlagsebesség-feltételezésből becsüljük. Ez NEM egyezik
 * pontosan a valós útviszonyokkal (kanyargós utak, dugók, stb.) — inkább egy ÉSSZERŰ KIINDULÁSI
 * TERV, amit a logisztikus a saját tapasztalata alapján még finomíthat/átrendezhet.
 *
 * A sorrend-építés heurisztikája:
 *  1. Minden megrendeléshez pontszámot számolunk: alapvetően a szélességi fok (dél→észak haladás),
 *     amit egy kis "prioritás-bónusszal" módosítunk a régebb óta váró megrendelések javára — de ez
 *     a bónusz korlátozott mértékű, hogy ne írja felül teljesen a földrajzi közelséget.
 *  2. A legdélebbi (bónusszal korrigált) pontból indulunk.
 *  3. Onnantól mohó (greedy) legközelebbi-szomszéd módszerrel haladunk: mindig azt a még nem
 *     érintett megállót választjuk, aminek a legkisebb az "költsége" — ami az utazási időből,
 *     egy dél felé visszafordulást büntető taggal, és a prioritás-bónuszból áll össze.
 *  4. A menetrendet reggel 4:30-kor indítjuk, és minden megállónál hozzáadjuk az utazási időt és a
 *     megadott telepítési időtartamot. Ha egy megálló már csak este 20:30 után férne bele, és
 *     2 napos tervet kértek, a maradék megállók a második napra kerülnek (ami szintén 4:30-kor
 *     indul, onnan folytatva, ahol az első nap véget ért). 1 napos terv esetén a bele nem férő
 *     megállók külön, "nem fér bele" listán jelennek meg.
 */

const AVG_SPEED_KMH = 55; // óvatos átlagsebesség-becslés (vegyes autópálya/vidéki út, megállásokkal)
const DEFAULT_DAY_START = '04:30';
const DEFAULT_DAY_END = '20:30';
const MAX_PRIORITY_BONUS_KM = 35; // ennyi "km-nyi" előnyt kaphat legfeljebb a legrégebb óta váró megrendelés

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function travelMinutes(km) {
  return (km / AVG_SPEED_KMH) * 60;
}

function timeStrToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function minutesToTimeStr(totalMin) {
  const m = Math.round(totalMin) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * @param {Array} customers - { id, name, lat, lng, createdAt (ISO string), installationMin }
 * @param {Object} options - { days: 1|2, dayStart: "HH:MM", dayEnd: "HH:MM", priorityWeightKm: number }
 * @returns {Object} { day1: [...], day2: [...], unscheduled: [...] }
 */
function planRoute(customers, { days = 1, dayStart = DEFAULT_DAY_START, dayEnd = DEFAULT_DAY_END, priorityWeightKm = MAX_PRIORITY_BONUS_KM } = {}) {
  const valid = customers.filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number' && !Number.isNaN(c.lat) && !Number.isNaN(c.lng));
  const skippedNoLocation = customers.filter((c) => !valid.includes(c));

  if (!valid.length) {
    return { day1: [], day2: [], unscheduled: [], skippedNoLocation };
  }

  // Prioritás-bónusz kiszámítása: a legrégebbi megrendelés kapja a teljes priorityWeightKm-et,
  // a legújabb 0-t, a többi lineárisan skálázva — ez "közelebbinek tünteti fel" a régóta várakozókat.
  // A súly (priorityWeightKm) kívülről paraméterezhető, hogy több, eltérő hangsúlyú változatot is
  // elő lehessen állítani (lásd generatePlanOptions).
  const ages = valid.map((c) => new Date(c.createdAt).getTime());
  const oldest = Math.min(...ages);
  const newest = Math.max(...ages);
  const ageRange = newest - oldest || 1;
  const withBonus = valid.map((c) => {
    const age = new Date(c.createdAt).getTime();
    const priorityBonusKm = ((newest - age) / ageRange) * priorityWeightKm;
    return { ...c, priorityBonusKm };
  });

  // Kiinduló pont: MINDIG a ténylegesen legdélebbi pont — a dél-észak haladás a felhasználó által
  // kifejezetten kért, elsődleges szempont, ezt a prioritás-bónusz itt még nem módosíthatja
  // (különben egy régóta váró, de északabbra eső megrendelés már a start-pontot is elcsúsztatná,
  // és a valódi legdélebbi pontot csak a nap végén, egy nagy dél felé tett kitérővel érnénk el).
  withBonus.sort((a, b) => a.lat - b.lat);
  const remaining = [...withBonus];
  const start = remaining.shift();

  const orderedStops = [start];
  let current = start;
  while (remaining.length) {
    let bestIdx = 0;
    let bestCost = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const distKm = haversineKm(current.lat, current.lng, cand.lat, cand.lng);
      let cost = distKm - cand.priorityBonusKm;
      // Dél felé visszafordulás ERŐS büntetése — a dél-észak haladás elsődleges szempont, ez nem
      // engedi, hogy a prioritás-bónusz (régi megrendelés) visszahúzzon délre.
      const latDelta = cand.lat - current.lat;
      if (latDelta < 0) cost += Math.abs(latDelta) * 111 * 4;
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }
    current = remaining.splice(bestIdx, 1)[0];
    orderedStops.push(current);
  }

  // Menetrend-építés: naponta dayStart-tól dayEnd-ig, útközben az utazási + telepítési idővel.
  // FONTOS: a napváltás döntése az ÉRKEZÉSI időn (nem a befejezési időn) múlik — ha a telepítés a
  // tervezett záró időpont UTÁNIG tart, az nem gond (ez a valóságban is gyakran előfordul), csak az
  // számít, hogy a helyszínre még a nap vége előtt megérkezzenek. Emiatt egy megálló csak akkor
  // csúszik át a következő napra, ha MÁR AZ ODAUTAZÁS sem férne bele aznapra.
  const dayEndMin = timeStrToMinutes(dayEnd);
  const days_ = [[], []];
  let dayIdx = 0;
  let clock = timeStrToMinutes(dayStart);
  let prevStop = null;
  const unscheduled = [];

  for (const stop of orderedStops) {
    const travelMin = prevStop ? travelMinutes(haversineKm(prevStop.lat, prevStop.lng, stop.lat, stop.lng)) : 0;
    const arrival = clock + travelMin;

    if (arrival > dayEndMin) {
      if (dayIdx === 0 && days === 2) {
        // Átlépünk a 2. napra — az odautazás időtartama TOVÁBBRA IS az előző nap utolsó
        // helyszínéhez (prevStop) képest van kiszámolva (ugyanaz a "travelMin", hiszen a távolság
        // nem függ az órától), hogy a két nap útvonala ténylegesen összekapcsolódjon.
        dayIdx = 1;
        clock = timeStrToMinutes(dayStart);
        const arrival2 = clock + travelMin;
        const done2 = arrival2 + (stop.installationMin || 90);
        days_[dayIdx].push({
          ...stop,
          eta: minutesToTimeStr(arrival2),
          doneAt: minutesToTimeStr(done2),
          travelMin: Math.round(travelMin),
          overrun: done2 > dayEndMin,
        });
        clock = done2;
        prevStop = stop;
        continue;
      }
      unscheduled.push(stop);
      continue;
    }

    const done = arrival + (stop.installationMin || 90);
    days_[dayIdx].push({
      ...stop,
      eta: minutesToTimeStr(arrival),
      doneAt: minutesToTimeStr(done),
      travelMin: Math.round(travelMin),
      overrun: done > dayEndMin, // a telepítés befejezése átcsúszhat a tervezett záró időponton — ez megengedett, csak jelezzük
    });
    clock = done;
    prevStop = stop;
  }

  return { day1: days_[0], day2: days_[1], unscheduled, skippedNoLocation };
}

/**
 * Összefoglaló egy elkészült tervről (a variánsok összehasonlításához): hány megálló fér bele,
 * mikor végeznek összesen, mennyi az összes becsült utazási idő.
 */
function summarizePlan(plan) {
  const allStops = [...plan.day1, ...plan.day2];
  const totalTravelMin = allStops.reduce((sum, s) => sum + (s.travelMin || 0), 0);
  const overrunCount = allStops.filter((s) => s.overrun).length;
  const lastStop = plan.day2.length ? plan.day2[plan.day2.length - 1] : plan.day1[plan.day1.length - 1];
  return {
    stopCount: allStops.length,
    unscheduledCount: plan.unscheduled.length,
    totalTravelMin: Math.round(totalTravelMin),
    overrunCount,
    finishDay: plan.day2.length ? 2 : 1,
    finishTime: lastStop ? lastStop.doneAt : null,
  };
}

/**
 * Több, eltérő hangsúlyú útvonalterv-változatot állít elő egyszerre, hogy a logisztikus
 * összehasonlíthassa és kiválaszthassa a neki megfelelőt — nem csak egyetlen, kötelezően
 * elfogadandó tervet kap.
 *  - "balanced": az alapértelmezett, mérsékelt prioritás-súllyal (a jelenlegi normál viselkedés)
 *  - "oldest_first": erősebben előnyben részesíti a régóta váró megrendeléseket, akár kisebb
 *    földrajzi kitérők árán is
 *  - "shortest_route": kizárólag a földrajzi közelség/dél-észak haladás számít, a várakozási idő
 *    egyáltalán nem befolyásolja a sorrendet — ez adja a legrövidebb becsült útvonalat
 */
function generatePlanOptions(customers, options = {}) {
  const variants = [
    { key: 'balanced', label: 'Zrównoważony (priorytet + geografia)', priorityWeightKm: MAX_PRIORITY_BONUS_KM },
    { key: 'oldest_first', label: 'Priorytet: najstarsze zamówienia', priorityWeightKm: MAX_PRIORITY_BONUS_KM * 2.5 },
    { key: 'shortest_route', label: 'Priorytet: najkrótsza trasa', priorityWeightKm: 0 },
  ];
  return variants.map((v) => {
    const plan = planRoute(customers, { ...options, priorityWeightKm: v.priorityWeightKm });
    return { key: v.key, label: v.label, plan, summary: summarizePlan(plan) };
  });
}

module.exports = {
  planRoute,
  generatePlanOptions,
  summarizePlan,
  haversineKm,
  travelMinutes,
  AVG_SPEED_KMH,
  DEFAULT_DAY_START,
  DEFAULT_DAY_END,
};
