# Calendar

Calendar shows your meetings in Orc from two kinds of connection:

- **A Google account.** Sign in and Orc shows every calendar on the account in
  the colour it has in Google Calendar. You can create, change, move and delete
  events, and reply to invitations.
- **An iCal address.** For Outlook, iCloud and any other calendar. Orc reads it
  and never changes it.

Up to five Google accounts and ten iCal addresses can be connected at once.

## Quiet during meetings

While a meeting is on, Orc makes no sound. **Quiet during meetings** in
Calendar settings turns this off; it is on by default and kept in each
browser. Settings → Sounds says when it is in force.

A meeting is an event with a start and an end time that lasts less than a
day, on a calendar you show. All-day events, events you declined and events
set to show as free do not count. Orc checks every five minutes, so a meeting
added or moved less than ten minutes before it starts can begin with a sound.

## What stays on this Mac

Signing in, connecting an address and every change to an event happen only in
Orc on the Mac that runs it. A paired device reads the meetings and gets no
controls to change them, and an agent that reaches Orc over MCP cannot change
them either.

Each Google sign-in is a refresh token in the macOS Keychain
(`ORC_CALENDAR_GOOGLE_REFRESH_1` to `_5`). `~/.orc/config.json` holds only the
account's address and which of its calendars show, under `calendar.google`.
Signing out revokes the token at Google and removes it from the Keychain.

## What Orc asks Google for

Two permissions: to see the list of your calendars, and to see and edit events.
Google has no narrower permission for replying to an invitation, so a reply
needs the second one too. A sign-in that leaves either box unticked is refused.

## How events are read

Orc reads the days on screen from each shown calendar and keeps that answer for
a minute. Any change made in Orc drops the calendar's saved answers, so the
next read shows it. A change made elsewhere shows within a minute of the next
refresh; the view refreshes every five minutes and whenever you come back to it.

## The Google sign-in app

Google only signs people in to an app that someone registered in Google Cloud.
Orc uses, in this order:

1. **Your own**, when you paste a client ID and secret under **Calendar
   settings → Use your own Google sign-in app**. The steps are on that screen.
2. **The one Orc ships**, read from `google-client.json` in this folder.

While `google-client.json` is blank, signing in needs your own app.

### Shipping a sign-in app with Orc

1. Create a Google Cloud project and enable the Google Calendar API.
2. In Google Auth Platform, set the audience to **External** and publish the
   app. Until Google has verified it, people see an "unverified app" warning and
   Google stops new sign-ins after 100 people.
3. Create a client of type **Desktop app**.
4. Put its ID and secret in `google-client.json`:

   ```json
   { "clientId": "…apps.googleusercontent.com", "clientSecret": "GOCSPX-…" }
   ```

Google treats a desktop app's secret as public: it names the app and protects
nothing, because the sign-in itself is protected by PKCE. GitHub's push
protection still flags it, so the push that adds it has to allow that secret.

## Limits

- Orc moves and retimes one event at a time. Changing when a whole repeating
  series happens, or its repeat pattern, is done in Google Calendar.
- A new event cannot be made to repeat from Orc.
- A description longer than about 3,900 characters, and a guest list longer
  than 100, are shown but not editable.
- Dragging needs a mouse or pen. On a touch screen, use **Edit**.
