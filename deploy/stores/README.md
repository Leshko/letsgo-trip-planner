# Getting LetsGo Together into the App Store and Google Play

The apps are built from the same code as the website (Capacitor). GitHub
builds both apps on every change ("phone apps" workflow). What's left needs
your developer accounts. Do the steps in order; each one says exactly where
the result goes. **Never paste a key into chat.** Keys go into the Docker tab
(server) or GitHub secrets (builds).

Files in this folder:
- `listing.md`: names, descriptions, keywords, URLs, age rating
- `privacy-answers.md`: answers for Apple "App Privacy" and Google "Data safety"
- `review-notes.md`: what to tell the reviewers, including the background-location explanation

---

## 1. Apple Developer Program (personal, $99/year)
1. On your iPhone, open the **Apple Developer** app → **Account** → sign in with your Apple ID → **Enroll Now** → choose **Individual**. (Enrolling on the phone is fastest; it verifies your ID with the camera.)
2. Pay the $99. Approval usually takes 1–2 days; you'll get an email.
3. When approved, go to https://developer.apple.com/account → **Membership details** and note your **Team ID** (10 characters). It isn't secret.
   - Put it in the Unraid Docker tab → letsgo → Edit → **Apple Team ID** → Apply.

## 2. Google Play Console (personal, $25 once)
1. Go to https://play.google.com/console/signup, sign in with your Google account, choose **Yourself**, pay $25, and verify your identity (ID photo). Takes a few days.
2. Google's rule for new personal accounts: before the app can go public, it must run a **closed test with at least 12 testers for 14 days in a row**. Start gathering 12+ family members' Gmail addresses (the people on the Dad's 60th trip are perfect). Each needs an Android phone.

## 3. Firebase (free, Android notifications)
1. Go to https://console.firebase.google.com → **Create a project** → name it `LetsGo Together` → Google Analytics **off** → Create.
2. Click the **Android** icon to add an app → package name **app.letsgotogether** → Register → **Download google-services.json**.
   - GitHub → Leshko/letsgo-trip-planner → Settings → Secrets and variables → Actions → **New repository secret** → name `GOOGLE_SERVICES_JSON` → paste the file's whole contents → Add.
3. Project settings (gear) → **Service accounts** → **Generate new private key** → a JSON file downloads.
   - Unraid Docker tab → letsgo → Edit → show more settings → **Firebase account** → paste the file's whole contents → Apply.

## 4. Apple push key (iPhone notifications)
1. https://developer.apple.com/account → **Certificates, IDs & Profiles** → **Keys** → **+** → name `LetsGo push` → tick **Apple Push Notifications service (APNs)** → Configure → environment **Sandbox & Production** → Save → Continue → Register → **Download** (you can only download it once, so keep the `AuthKey_XXXXXXXXXX.p8` file somewhere safe).
2. Note the **Key ID** shown on that page (10 characters).
3. Unraid Docker tab → letsgo → Edit → show more settings:
   - **Apple push key ID** → the Key ID
   - **Apple push key** → open the .p8 file in a text editor, copy everything, paste → Apply.

## 5. Tell me when 1–4 are done
I then add the signed release builds: GitHub uploads the iPhone app to TestFlight and the Android app to Play's test track automatically. For that I'll ask you to create two more keys (App Store Connect API key, Play service account) and add them as GitHub secrets, with the same click-by-click steps.

## 6. Store listings and review (after the first test builds)
- Fill in the listing from `listing.md` and the privacy forms from `privacy-answers.md`.
- Create a demo trip for the reviewers (see `review-notes.md`).
- Android: add your 12+ testers to the closed test, wait 14 days, then **Apply for production**.
- iPhone: TestFlight lets the family test right away; then **Submit for Review**.
- Android app links: after the first Play upload, Play Console → **Test and release → App integrity → App signing** → copy the **SHA-256 certificate fingerprint** → Unraid Docker tab → **Android key fingerprint** → Apply. (Invite links then open the Android app.)

## What each Docker-tab setting does (all optional; empty = off)
| Setting | Turns on |
|---|---|
| Apple Team ID | iPhone app links (invite links open the app) and, with the two below, iPhone notifications |
| Apple push key ID + Apple push key | iPhone app notifications |
| Firebase account | Android app notifications |
| Android key fingerprint | Android app links |

The website keeps working exactly as before whether these are set or not.
