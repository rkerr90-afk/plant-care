# Plant Care (phase 1)

Photograph a plant, confirm what it is, and get one reminder a day for the plants that need checking. Installable PWA for iPhone. Next.js on DigitalOcean App Platform, Supabase for sign-in, data and photos, Claude for identification and care profiles.

Phase 1 covers: email and password sign-in, photo ID with top 3 confirm, context questions, quick-add, adaptive indoor watering, pet toxicity badges, fixing a wrong ID, push digest, due list, settings, account deletion. Outdoor weather logic, frost alerts, away mode, health check, feeding and the journal come in phases 2 and 3.

## Setup (about 30 minutes)

### 1. Supabase
1. Create a project at supabase.com (free tier is fine). Pick the London region.
2. **SQL Editor**: paste and run `supabase/schema.sql`.
3. **Authentication > Sign In / Providers > Email**: switch **Confirm email** OFF. The app signs in with email and password, so no emails are sent and no SMTP setup is needed. (A magic link would open Safari instead of the installed app, which is why there are no links.)
4. Leave sign-ups enabled so the person you share it with can create their own account. To make it invite-only later, switch sign-ups off and add users by hand under Authentication > Users.
5. **Project Settings > API**: copy the Project URL, the `anon` key and the `service_role` key.

### 2. Other keys
- **Anthropic**: create an API key at console.anthropic.com.
- **VAPID keys** for push: run `npx web-push generate-vapid-keys` and keep both values.
- **CRON_SECRET**: any long random string (`openssl rand -hex 24`).

### 3. GitHub
Create a private repo and push this folder to it. `.env` files are git-ignored.

### 4. DigitalOcean App Platform
1. Create App, choose the GitHub repo, branch `main`. It detects Node.
2. Build command `npm run build`, run command `npm start`, HTTP port 8080 (App Platform sets `PORT` for you).
3. Add environment variables from `.env.example`. Mark the three `NEXT_PUBLIC_*` ones as available at **build time** as well as run time.
4. Deploy. You get a URL like `https://plant-care-xxxxx.ondigitalocean.app`.

### 5. Start the hourly digest
1. Supabase **Database > Extensions**: enable `pg_cron` and `pg_net`.
2. Edit `supabase/cron.sql`: set your app URL and `CRON_SECRET`, then run it in the SQL Editor.
3. The job runs on the hour. A reminder set for 12:00 arrives at 12:00; one set for 12:30 arrives at 13:00.

### 6. Install on iPhone
1. Open the app URL in **Safari** and create your account with an email and password.
2. Share button, **Add to Home Screen**, then open Plants from the home screen.
3. Tap **Turn on reminders** and allow notifications. Settings has a **Send test notification** button.
4. Set your postcode and tick "I have pets" in Settings.

To share it, send the other person the same URL. They sign up with their own email and get their own plants.

## Running locally
```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:3000
npm test                     # watering logic tests
npm run typecheck
```
Camera capture and push need HTTPS, so test those on the deployed URL.

## How watering is decided
Next due date = species base interval, then multiplied by light, pot material and size, a radiator in heating season, a dormancy stretch in winter months for the species, and a personal factor that "Still moist" nudges up 10% and "Bone dry" nudges down 10% (bounded 0.5 to 2). The logic is in `lib/care.ts` with tests in `lib/care.test.ts`. The multipliers are starting values: adjust them after a few weeks of real use.

## Cost
Each photo identification is one Claude call. A care profile is generated once per species and cached for everyone. `DAILY_AI_CAP` (default 20) limits photo calls per user per day.

## Layout
- `supabase/schema.sql`, `supabase/cron.sql`: database and hourly job
- `lib/care.ts`: watering logic (pure, tested)
- `lib/claude.ts`: identification and care profile prompts
- `app/actions.ts`: all writes (server actions)
- `app/api/cron/digest/route.ts`: the digest sender
- `public/sw.js`, `public/manifest.webmanifest`: PWA shell
