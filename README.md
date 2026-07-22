# Pol-Bram Garázs CRM — backend + backoffice

Ez a rendszer a garázs-igénybejelentő űrlap (a weboldalatokba illesztett `garazs-igenyles.html`)
mögötti **teljes folyamatot** kezeli:

1. Ügyfél beküldi az igényét → automatikus visszaigazoló e-mail az ügyfélnek + az igény megjelenik a backoffice listában
2. Ti (backoffice-ban) kiszámoljátok az árat, kikülditek az ajánlatot
3. Ügyfél az e-mailben lévő gombbal elfogadja → státusz automatikusan vált
4. Ti legenerálódó megrendelőlapot (HU + PL) küldtök: előbb a lengyel kolléganőnek jóváhagyásra, utána a véglegeset az ügyfélnek
5. Előlegszámla feltöltése + kiküldése
6. "Telepítve" gomb → értesítés az ügyfélnek, elégedettség-értékelő és reklamáció-beküldő linkkel
7. Reklamáció esetén a panasz és a feltöltött képek megjelennek a backoffice-ban

---

## 1. Amit tudnod kell, mielőtt elkezded

- Ez egy **Node.js szerver-alkalmazás** — nem fut böngészőben, telepíteni kell egy szerverre.
- **Adatbázis:** SQLite (egyetlen fájl, nincs szükség külön adatbázis-szerverre).
- **E-mail küldés:** Gmail / Google Workspace fiókon keresztül (SMTP + alkalmazásjelszó).
- **PDF-generálás:** Puppeteer (egy beépített Chrome böngészőt tölt le telepítéskor — ehhez internetkapcsolat kell a szerveren, ez normál hosting esetén magától működik).

---

## 2. Hova telepítsük? (ajánlás)

Mivel még nincs szerveretek, a **Render.com**-ot javaslom:
- Ingyenes/olcsó csomagja van kisvállalkozásoknak,
- automatikusan telepít egy GitHub-repóból,
- támogatja a Node.js-t és a Puppeteert is,
- nem igényel szerver-adminisztrációs tudást.

(Alternatíva: Railway.app, vagy egy hagyományos VPS — pl. Hetzner/DigitalOcean —, ha inkább teljes kontrollt szeretnétek. Ez utóbbihoz egy fejlesztő/rendszergazda segítsége hasznos lehet a beüzemeléshez.)

### Telepítés Render.com-ra (lépésről lépésre)

1. Hozz létre egy ingyenes fiókot a [render.com](https://render.com) oldalon.
2. Töltsd fel ezt a projektet egy GitHub repóba (vagy kérd meg a fejlesztődet/kollégádat, hogy segítsen ebben).
3. Render-en: **New + → Web Service**, kösd össze a GitHub repóval.
4. Beállítások:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** a legkisebb ingyenes/fizetős csomag is elég eleinte
5. **Environment Variables** (Render felületén, "Environment" fül) — töltsd ki a `.env.example` fájl alapján az összes változót (lásd lentebb, hogyan szerezd meg a Gmail-jelszót).
6. **Persistent Disk hozzáadása** (fontos!): Render-en adj hozzá egy Disk-et (pl. 1 GB, mount path: `/opt/render/project/src/data` és `/opt/render/project/src/uploads`), különben az adatbázis és a feltöltött fájlok minden újraindításkor elvesznének.
7. Deploy — pár perc után megkapod a nyilvános URL-t (pl. `https://pol-bram-crm.onrender.com`).
8. Futtasd le egyszer az admin-létrehozó parancsot (Render "Shell" fülén): `npm run init-admin`

---

## 3. Gmail alkalmazásjelszó beszerzése

1. Lépj be a Google Fiókodba (amiről az e-mailek mennek, pl. `ajanlat@pol-bram.hu`)
2. **Biztonság** → **Kételemes azonosítás** bekapcsolása (ha még nincs)
3. **Biztonság** → **Alkalmazásjelszavak** → hozz létre egyet "Mail" néven
4. A kapott 16 karakteres jelszót másold a `.env` fájl `GMAIL_APP_PASSWORD` sorába

Google Workspace-nél ugyanez működik; ha a rendszergazda letiltotta az alkalmazásjelszavakat,
kérd meg, hogy engedélyezze, vagy váltsunk Gmail API + OAuth2 hitelesítésre (bonyolultabb, de robusztusabb — szólj, ha erre van szükség).

**Napi limit:** sima Gmail fiók kb. 500 e-mail/nap, Google Workspace kb. 2000/nap — kisvállalkozási forgalomhoz bőven elég.

---

## 4. Helyi tesztelés (fejlesztői gépen)

```bash
cd garage-crm
npm install
cp .env.example .env
# szerkeszd a .env fájlt a saját adataiddal
npm run init-admin
npm start
```

Ezután nyisd meg: `http://localhost:3000/admin`

---

## 5. A garázs-igénylő form és a domain összekötése

**Fontos változás:** a garázs-igénylő oldal (`public/site/index.html`) mostantól **a backenddel egy
Render-alkalmazásból fut** — nincs szükség külön `BACKEND_URL` beállításra (üresen hagyva relatív,
azaz ugyanarra a domainre hivatkozik).

Ha a `polbram.hu` domaint erre az alkalmazásra irányítod (Render → Settings → Custom Domains → Add Custom Domain,
majd a domain.hu-s DNS-kezelőben egy A/CNAME rekord hozzáadása a Render által mutatott célra), akkor:

- `https://polbram.hu/` → a garázs-igénylő form
- `https://polbram.hu/admin` → a backoffice
- A meglévő `pol-bram.hu` (Rackhost, WordPress) változatlanul, külön fut tovább

---

## 6. Amit még véglegesíteni kell, mielőtt élesben használjátok

- **Árazási motor** (`src/services/pricing.js`): az Excel-kalkulátorból kinyert, de közelítő logika —
  **egyeztessétek néhány valós példán** a pontos Excel-eredménnyel, és ha eltér, itt javítsátok a számokat.
- **Megrendelőlap PDF sablon** (`src/services/pdf.js`): jelenleg egy egyszerű, letisztult elrendezést tartalmaz —
  ha van pontos elvárásotok a kinézetre (fejléc, logó, pontos mezők), küldjétek el, és testreszabom.
- **E-mail szövegek** (`src/services/email.js`): a szövegezés módosítható, ha máshogy szeretnétek fogalmazni.

---

## 7. Fájlstruktúra

```
garage-crm/
├── server.js              # belépési pont
├── db.js                  # SQLite séma
├── src/
│   ├── routes/
│   │   ├── auth.js         # bejelentkezés
│   │   ├── admin.js        # backoffice API (védett)
│   │   └── public.js       # ügyfél felőli végpontok (igény, elfogadás, reklamáció)
│   ├── services/
│   │   ├── pricing.js      # árazási motor
│   │   ├── email.js        # e-mail sablonok + küldés
│   │   └── pdf.js          # megrendelőlap PDF generálás
│   └── middleware/requireAuth.js
├── public/admin/           # backoffice felület (HTML/CSS/JS)
├── scripts/create-admin.js # admin felhasználó létrehozása
├── data/                   # SQLite adatbázis fájl (automatikusan létrejön)
└── uploads/                # feltöltött előlegszámlák és reklamációs képek
```

## 8. Típusgarázsok kezelése (backoffice)

A típusgarázsokat (amiket az ügyfél-oldali form legördülő listája + ikonos galériája mutat)
mostantól **a backoffice-ban** hozzátok létre és szerkesztitek — nem a kódban vannak rögzítve.

- Backoffice → **"Típusgarázsok"** fül → **"+ Új típusgarázs"**
- Adj neki nevet, tölts fel hozzá egy képet (ez jelenik meg az ügyfél-oldali ikonon), majd állítsd be
  a teljes konfigurációt (méret, tető, szín, kapu, ablakok, stb. — ugyanaz a felület, mint az ügyfél-oldalon)
- **Mentés** — ezután azonnal megjelenik az ügyfél-oldali listában is
- Meglévő típus szerkesztéséhez/törléséhez: a "Típusgarázsok" listában a kártyán lévő gombok
