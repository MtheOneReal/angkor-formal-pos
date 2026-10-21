# Angkor Formal – Firebase (free Spark plan) setup

Everything runs in the browser and talks to your Firebase project `angkor-formal-pos`. No server, no Mac mini.

## One-time, on any computer with Node 20+ and Java 17+
1. `npm install`
2. `npm run test:logic`   (app logic, no Java needed) – should say pass 6, fail 0
3. `npm run test:rules`   (security rules against the Firebase emulator – needs Java and internet). **Send the result to Claude before going live.**
4. `npm run build`
5. `npx firebase login`
6. `cd fb && npx firebase deploy --only firestore:rules,hosting --project angkor-formal-pos`

Your app is then live at https://angkor-formal-pos.web.app

## First use
Open the address. The first screen asks you to create the first owner (email + password). It seeds the 5 stores, brands, types and colours. Then Settings → Staff to add managers (email + password) and cashiers (PIN, 6 digits recommended).

## Honest limits of the free, no-server design
- Stock numbers are updated by the browser, protected by security rules; a daily stock check is advised.
- Cashier PIN guessing is slowed only by Firebase's own throttling: use 6-digit PINs.
- Profit uses today's cost, not the cost at the time of sale.
- Photos are stored small inside the database (no Storage on the free plan).
- Free quota: 50,000 reads / 20,000 writes per day – fine for 5 stores.
- Backups need the paid plan; export stock regularly.
- Khmer wording needs a native speaker's review.
