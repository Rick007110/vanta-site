# Vanta-website

Statische website voor Vanta: een landingspagina (`index.html`) en een beheerdashboard (`admin/`). Gewoon HTML, CSS en
JavaScript: geen build-stap, geen server-code. Alleen het dashboard laadt `supabase-js` van jsDelivr.

## Inhoud

| Pad | Wat |
|---|---|
| `index.html` | landingspagina; downloadknop haalt de nieuwste `Vanta-v*.zip` op via de GitHub-API (valt terug op de releases-pagina) |
| `privacy/index.html` | privacyverklaring (Engels standaard, Nederlands via de EN/NL-schakelaar) |
| `admin/index.html` | beheer: inloggen met Discord, tabbladen Meldingen, Aanvragen en Statistieken |
| `assets/css`, `assets/js`, `assets/fonts`, `assets/img` | stijlen, scripts, lettertypen (Geist, SIL OFL) en logo |
| `assets/js/i18n.js`, `assets/js/i18n/en.js`, `nl.js` | vertalingen: Engels is overal standaard, Nederlands alleen als de bezoeker NL kiest (onthouden in `localStorage`, sleutel `vanta-lang`); teksten staan per taal in één bestand, elementen verwijzen ernaar met `data-i18n` |
| `assets/js/config.js` | Supabase-URL en **publishable** key (die mag openbaar zijn) |
| `robots.txt`, `admin/.htaccess` | houdt `/admin/` uit zoekmachines (naast de `noindex`-metatag) |

Er staat nergens een secret/service_role key in de site en die hoort er ook nooit in. Alle beheerdata is alleen
bereikbaar via database-functies die zelf controleren of je Discord-account beheerder is.

## Eenmalig in Supabase (vóór het uploaden)

1. **SQL uitvoeren**: Dashboard → SQL Editor → New query → plak de inhoud van `supabase/supabase-setup.sql` uit de
   Vanta-repo (of alleen `supabase/migrations/20260928120000_game_requests_admin.sql`) → Run. Veilig om opnieuw te
   draaien; het voegt de game-aanvragen, de beheerderstabel (met jouw Discord-id) en de beheerfuncties toe.
2. **Redirect-URL toevoegen**: Authentication → URL Configuration
   * **Redirect URLs** → Add URL: `https://jouwdomein.nl/admin/` (precies het adres van de beheerpagina, met `/` aan het
     eind; gebruik je ook `www.`, voeg die variant dan ook toe). Laat de bestaande loopback-URL van de app
     (`http://127.0.0.1:*/callback*`) staan.
   * **Site URL**: mag `https://jouwdomein.nl/` worden. Staat daar nu iets anders dat de app nodig heeft, laat het dan
     staan; de redirect-URL uit de vorige stap is genoeg.

Discord-login zelf staat al aan; daar hoeft niets te veranderen (de callback-URL bij Discord blijft
`https://zwglyogpkcynnopafvsb.supabase.co/auth/v1/callback`).

## Uploaden

1. Pak `vanta-site.zip` uit.
2. Upload de **inhoud** van de map (dus `index.html`, `robots.txt`, `assets/`, `admin/` en `privacy/`) naar de webroot van je
   hosting (vaak `public_html/` of `www/`) via FTP/SFTP of de bestandsbeheerder van je host. `LEESMIJ.md` hoeft niet mee.
3. Zorg dat de site via **https** bereikbaar is (Discord-login werkt niet goed zonder).
4. Open `https://jouwdomein.nl/` en controleer of de downloadknop het versienummer toont.
5. Open `https://jouwdomein.nl/admin/`, klik **Continue with Discord** en log in met je eigen account. Andere accounts
   krijgen "No access" en worden direct uitgelogd.

Staat de site in een submap (bijv. `jouwdomein.nl/vanta/`)? Dat werkt ook: alle paden zijn relatief. Gebruik dan
`https://jouwdomein.nl/vanta/admin/` als redirect-URL en pas in `robots.txt` het pad aan naar `/vanta/admin/`.

## Beheer in het kort

* **Reports**: alleen cheats met minstens één "doesn't work"-melding, per game + cheat samengevoegd met tellers
  ("3 broken · 5 works"); cheats met alleen "works"-meldingen staan er niet in (Stats telt ze wel mee). Gesorteerd op prioriteit; filter op game en status. Knoppen: *Fixed in…* (met Vanta-versie),
  *Won't fix / can't reproduce*, *Duplicate*, *Reopen*. Onder *reporters* kun je een melder blokkeren. Statuswijzigingen
  gaan ook naar de Discord-bot (die werkt zijn bericht bij).
* **Requests**: game-aanvragen op aantal stemmen; zet de status (open, planned, in progress, added, rejected) en een
  notitie die spelers in de app zien. *Delete* verwijdert een aanvraag met alle stemmen.
* **Stats**: gebruikers, meldingen, open problemen, stemmen, grafiek van 14 dagen, per game, en geblokkeerde gebruikers
  (met *Unban*).

Extra beheerder toevoegen (SQL Editor): `insert into vanta.admins (discord_id) values ('<discord-id>');`

## Lokaal bekijken

`python3 -m http.server 8000` in deze map en open `http://127.0.0.1:8000/`. Met `http://127.0.0.1:8000/admin/?demo=1`
zie je het dashboard met voorbeelddata (werkt alleen op localhost; er wordt dan niets met Supabase gedaan).

MIT-licentie, © 2026 Rick007110.
