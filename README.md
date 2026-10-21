# Angkor Formal – shop system (first working version)

One web app for all five stores: cashier register, stock, transfers between stores, catalogue with barcode labels, receipts, customers, and an owner dashboard. Works in English and Khmer.

## Run it on the Mac mini (first time)

1. Install Node.js version 22.13 or newer from nodejs.org (the "LTS" or "Current" download).
2. Open Terminal and go into this folder: `cd path/to/angkor-system`
3. Install: `npm install --omit=dev`
4. Create the demo shops and people: `npm run seed`
5. Start: `npm start`
6. Open http://localhost:3000 in a browser. Other devices on the same Wi-Fi use http://<mac-mini-ip>:3000

Demo logins (change before real use):
- Owner: `vibol@demo.local` / `Demo-1234` (also bunhong, bunheng, chhovkheng, sokha @demo.local)
- Manager: `manager1@demo.local` … `manager5@demo.local` / `Demo-1234`
- Till: choose store → choose name → PIN. Sophea (Angkor Formal) PIN 1101.
- Manager approval PINs: 8001–8005.

## Before real use
- Settings → Staff: change every password and PIN, then delete or deactivate the demo people.
- Settings → Stores & rules: set the real 5th store name, discount limit, switches.
- Replace the demo catalogue with your real designs (Catalogue → New design) and receive stock (Stock → Receive delivery).
- Start with a fresh database: stop the app, delete the `data` folder, run `npm run seed` only if you want demo data again. For a clean empty system ask me for the "empty setup" step.

## Backups
The app saves a copy of the database every day in `data/backups` (keeps 30). Copy that folder to an external drive or cloud drive regularly. To restore: stop the app, copy a backup file over `data/angkor.db`, start again.

## Tests
`npm test` runs 18 automatic checks (roles, money, stock, transfers, dashboard totals).

## Not built yet
Expenses, staff attendance and monthly salary, alterations board, owner two-step login, device registration, Telegram summaries, deposits/holds. Khmer wording needs a native reader to check. VAT/tax invoice format is not confirmed. Hosting (so it works outside the shop Wi-Fi) is not decided.
