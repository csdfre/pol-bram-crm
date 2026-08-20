/**
 * A kiszállítási cím és a hozzá tartozó Google Maps link egységes kiszámítása.
 * ---------------------------------------------------------------
 * - Ha van pontos helyszín (delivery_lat/delivery_lng — a sofőr/admin által a Google Maps-en
 *   kijelölt pont), a térkép-link ERRE a koordinátára mutat, nem a szöveges címre — ez azért
 *   fontos, mert egy szöveges cím geokódolása néha pontatlan (pl. új utca, elgépelt házszám),
 *   míg egy kézzel kijelölt pont mindig pontos.
 * - A megjelenített CÍM szövege a delivery_address felülírás, ha van (ezt az admin szerkesztheti
 *   a kiszállítási listában anélkül, hogy a megrendelés eredeti address/zip/city mezőit módosítaná)
 *   — ha nincs felülírás, az eredeti megrendelési cím az irányadó.
 */

function resolveDeliveryAddress(customer) {
  if (customer.delivery_address && customer.delivery_address.trim()) {
    return customer.delivery_address.trim();
  }
  return [customer.address, customer.zip, customer.city].filter(Boolean).join(', ');
}

function buildMapsLink(customer) {
  if (customer.delivery_lat != null && customer.delivery_lng != null) {
    return `https://www.google.com/maps?q=${customer.delivery_lat},${customer.delivery_lng}`;
  }
  const address = resolveDeliveryAddress(customer);
  if (!address) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(address)}`;
}

/**
 * Egy beillesztett Google Maps link (pl. megosztott hely-link, vagy a böngésző címsorából
 * kimásolt URL) szövegéből megpróbálja kinyerni a lat/lng koordinátákat. Több gyakori formátumot
 * ismer fel (pl. ".../@47.123,19.456,17z", "...?q=47.123,19.456", vagy egyszerűen "47.123,19.456"
 * nyers koordináta-pár). Ha nem talál benne koordinátát, null-t ad vissza.
 */
function parseLatLngFromMapsLink(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const patterns = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/, // .../@47.123,19.456,17z
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/, // ...?q=47.123,19.456
    /^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/, // nyers "47.123,19.456" bemásolva
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  return null;
}

module.exports = { resolveDeliveryAddress, buildMapsLink, parseLatLngFromMapsLink };
