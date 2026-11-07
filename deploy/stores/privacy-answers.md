# Privacy answers for the stores

What the app actually collects, so the App Store "App Privacy" and Google Play "Data safety" forms match the privacy page (https://letsgotogether.app/privacy).

| Data | Collected | Why | Linked to the person | Shared with others outside the trip | Optional | Deleted |
|---|---|---|---|---|---|---|
| Name (as typed when joining) | Yes | App functionality | Yes | No | No | With the trip / on request |
| Email address | Only if they sign in | Account sign-in | Yes | No (sent through Resend to deliver the sign-in code) | Yes | Delete account in the app |
| Photos (trip album, profile picture) | Yes, when they add them | App functionality | Yes | No | Yes | With the trip / on request |
| Messages (wall posts, comments) | Yes | App functionality | Yes | No | Yes | With the trip / on request |
| Precise location | Only if they turn on "Share my location" during a trip | App functionality (family map) | Yes | No | Yes | Deleted when they switch it off, and automatically at midnight after the trip's last day |
| Device push token | Only if they turn on notifications | App functionality | Yes | No (sent through Apple/Google to deliver notifications) | Yes | When they turn notifications off or uninstall |
| Links pasted for ideas | Yes | App functionality (AI summary of the public page through Anthropic, if the trip organizer's server has it on) | No | No | Yes | With the trip |

Not collected: contacts, health, financial info, browsing history, advertising ID, crash/analytics data. No tracking (Apple: "Data Not Used to Track You"). No ads.

## Apple App Privacy (the form's wording)
- Contact Info → Name, Email Address: App Functionality; Linked to user; Not used for tracking.
- User Content → Photos or Videos, Other User Content: App Functionality; Linked; Not tracking.
- Location → Precise Location: App Functionality; Linked; Not tracking.
- Identifiers → Device ID: **No** (push tokens are not identifiers in Apple's sense).

## Google Play Data safety (the form's wording)
- Data is encrypted in transit: **Yes** (HTTPS).
- Users can request deletion: **Yes** (in the app for accounts; trip organizer / support for trip data).
- Location → Approximate and Precise: Collected, not shared, optional, purpose "App functionality".
- Personal info → Name, Email: Collected, not shared, purpose "App functionality, Account management".
- Photos and videos → Photos: Collected, not shared, optional.
- Messages → Other in-app messages: Collected, not shared, optional.
