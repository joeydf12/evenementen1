# Deploy naar Vercel (Vite + React)

Stap-voor-stap deploy naar Vercel (Vite + React)

1) Koppel repo
   - Log in op vercel.com en kies "New Project" -> importeer 'joeydf12/evenementen1'.

2) Build settings (als Vercel het niet automatisch detecteert)
   - Build command: npm run build
   - Output directory: dist

3) Environment variables
   - Ga naar Project → Settings → Environment Variables.
   - Voeg hier alle variabelen toe (Production/Preview/Development).
   - Voor client-side variabelen gebruik prefix VITE_ (bv. VITE_API_URL).
   - Na toevoegen: trigger een redeploy (Vercel doet dat meestal automatisch).

4) Optionele CLI
   - Login: npx vercel login
   - Add env var via CLI: npx vercel env add VITE_API_URL production
   - Deploy productie via CLI: npx vercel --prod

5) Controleren
   - Open de Preview build of de Production URL die Vercel geeft.
   - Controleer in de console (of netwerk calls) dat import.meta.env.VITE_API_URL de verwachte waarde bevat.

Checklist
- Zorg dat build command `npm run build` en output `dist` zijn ingesteld in Vercel.
- Zet alle gevoelige waarden in Vercel Environment Variables (Production/Preview).
- Prefix client-side env-vars met VITE_.
- Voeg `.env*` toe aan .gitignore (is al gedaan).
- Voeg indien nodig vercel.json rewrites toe voor SPA routing.

Opmerkingen
- Vergeet niet om echte keys die per ongeluk gepusht zijn te roteren (wijzig/annuleer die bij de provider).

