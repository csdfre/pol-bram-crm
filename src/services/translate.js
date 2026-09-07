/**
 * Egyszerű, API-kulcs nélküli gépi fordítás — a Google Translate nem hivatalos, ingyenes
 * webes végpontját hívja meg. FONTOS KORLÁTOK, amikről tudni kell:
 *  - Ez NEM a hivatalos, fizetős Google Cloud Translation API — egy dokumentálatlan, bármikor
 *    változhat/leállhat végpont, amit sok kisebb, alacsony forgalmú projekt pragmatikusan használ.
 *  - Nincs garantált rendelkezésre állás — ezért MINDIG hibatűrően (try/catch) hívjuk, és hiba
 *    esetén az EREDETI szöveget mutatjuk a fordítás helyett, sosem hagyjuk üresen/hibásan.
 *  - Csak rövidebb, alkalmi szövegekhez (pl. egy-egy reklamáció szövege) ajánlott, nem tömeges,
 *    magas forgalmú fordításhoz — ehhez a hivatalos, fizetős API lenne a megfelelő megoldás.
 */
async function translateText(text, targetLang) {
  if (!text || !text.trim()) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    const data = await res.json();
    // A válasz szerkezete: [[[translated_chunk, original_chunk, ...], ...], ...] — több darabra eshet
    // szét hosszabb szövegnél, ezeket összefűzzük.
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((chunk) => chunk[0]).join('');
    }
    return null;
  } catch (e) {
    console.error('Fordítási hiba:', e.message);
    return null;
  }
}

async function translateToPolish(text) {
  return translateText(text, 'pl');
}

module.exports = { translateText, translateToPolish };
