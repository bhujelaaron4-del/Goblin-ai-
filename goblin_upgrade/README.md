# Goblin AI (free, with memory)

A private chat assistant with a password. You open one link on any phone, tablet, laptop or PC.
It remembers what you tell it, on every device, until you tell it to forget. You can send it screenshots and homework, and you can talk to it by voice.

It runs on free services:

- **AI:** Google Gemini (free key from Google AI Studio)
- **Hosting:** Vercel (free "Hobby" plan, for personal use)
- **Memory:** an Upstash Redis database, added from Vercel (free plan)
- **Password:** built in. Only you can use it.

Free plans have limits. If you send too many messages, the assistant says the free limit was reached. Wait and try again later. The companies can change their free rules, so check their sites if something stops working.

## How memory works

- While you chat, Goblin saves lasting facts as short sentences: your name, people, work, plans, tastes, decisions.
- Before every reply, it reads those facts, so it knows you on any device.
- A small note under the reply shows what it saved ("Remembered: ...").
- Tap the flame at the top to see everything it remembers. You can add things, remove one thing, or **Forget everything**.
- You can also just say it: "Remember that my sister's birthday is in May." or "Forget my address."
- It keeps up to 300 memories, 400 characters each. It never saves anything that looks like a password, API key or card number.

It remembers facts, not every word. The chat itself is also saved in your own database, so it shows on every device (see "Chat on every device").

## Setup (about 20 minutes)

### Step 1. Get a free Gemini key
1. Go to https://aistudio.google.com and sign in with a Google account.
2. Click **Get API key**, then **Create API key**.
3. Copy the key and keep it secret. Do not share it or post it online.

### Step 2. Put the code on GitHub
1. Make a free account at https://github.com
2. Click **New repository**. Name it `my-assistant`. Choose **Private**. Click **Create repository**.
3. Click **uploading an existing file**.
4. Open the unzipped `goblin-ai` folder and drag **everything inside it** (the folders `api`, `lib`, `public` and the files `package.json`, `vercel.json`, `README.md`, `.gitignore`) into the page.
5. Click **Commit changes**.

### Step 3. Put it online with Vercel
1. Go to https://vercel.com and sign up with your GitHub account (free Hobby plan).
2. Click **Add New... > Project** and choose your `my-assistant` repository.
3. Before you click Deploy, open **Environment Variables** and add these:

| Name | Value |
|---|---|
| `APP_PASSWORD` | The password you want to use to log in. Make it long (12+ characters, at least 8). |
| `SESSION_SECRET` | Any random text, 32+ characters. Just mash the keyboard. |
| `GEMINI_API_KEY` | The key from Step 1. |

4. Click **Deploy**. Wait one or two minutes.
5. Vercel shows you a link like `https://my-assistant-xxxx.vercel.app`. That is your assistant.

### Step 4. Turn on memory
Without this step Goblin works, but the flame at the top says **off** and nothing is remembered.

1. In Vercel, open your project and go to the **Storage** tab.
2. Add a **Redis** database from the Marketplace. Choose **Upstash** and the free plan, then connect it to your project. (Vercel changes its menus now and then. Look for "Upstash" and "Redis".)
3. Vercel adds the connection variables to your project by itself. They start with `KV_` or `UPSTASH_`.
4. Go to **Deployments**, open the latest one, and choose **Redeploy**.
5. Open your link. The flame at the top should show a number (0 at first) instead of "off".

If it still says "off": open your database in Upstash, copy the **REST URL** and **REST Token**, and add them in Vercel under **Settings > Environment Variables** as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Then redeploy.

### Step 5. Use it everywhere
Open the link on any device and log in with your password.
- **Android (Chrome):** menu, then **Add to Home screen**.
- **iPhone (Safari):** Share button, then **Add to Home Screen**.

### Step 6 (optional). Hear replies in the "Severin" voice
Every assistant reply has a **Listen** button. Without extra setup it reads the reply with the free voice built into your device. To use the ElevenLabs voice "Severin" (https://elevenlabs.io/voices/ib8aaABAPZQpTo6hx8Jr) instead:
1. Make a free account at https://elevenlabs.io
2. Open the Severin page above and click **Use voice** so it is saved in your account (**My Voices**).
3. In ElevenLabs, create an **API key** (in your profile or developer settings).
4. In Vercel, add this variable, then **Redeploy**:

| Name | Value |
|---|---|
| `ELEVENLABS_API_KEY` | Your ElevenLabs key |

The app already knows Severin's voice ID. You can use another voice with `ELEVENLABS_VOICE_ID`.

Important: the ElevenLabs free plan has a small monthly amount of text (about 10,000 characters, please check their pricing page), and some library voices may need a paid plan. To save your free amount, each Listen reads at most the first 1,200 characters. When ElevenLabs refuses or runs out, the app says why and reads the reply with your device voice instead.

## Chat on every device
Start a chat on your phone and carry on from your laptop. The page saves the chat to your Upstash database after each message, and checks for a newer one whenever you come back to the tab. Only text is saved, never the files. If it does not update, switch to another tab and back.

## Music
Say or type **"play Perfect by Ed Sheeran"** and Goblin opens a small player above the chat box. Tap the **heart** while a song plays to save your **favorite part** (for example 1:32). Next time you ask for that song, Goblin starts from your favorite part. Tap the song chip under a reply to play it again, and **x** to close the player.

The player needs a free YouTube key. Without one, Goblin still works: it shows an **Open on YouTube** button that opens the search.
1. Go to console.cloud.google.com, make or pick a project, and open **APIs & Services > Library**.
2. Search **YouTube Data API v3** and press **Enable**.
3. Open **APIs & Services > Credentials > Create credentials > API key**.
4. In Vercel, open **Settings > Environment Variables**, add `YOUTUBE_API_KEY` with that key, then **Redeploy**.

The free plan allows about 100 song searches a day.

## Feelings
Goblin has moods. A small face appears next to its name (happy, excited, loving, nostalgic, sad, curious, sleepy, proud) and the glow around its picture changes colour. It reacts to what you tell it and what you play, and it remembers things that matter to you. It is an AI, and it will say so honestly if you ask whether its feelings are real.

## To-do and homework list
Open the menu, tap **To-do**, and add tasks with an optional due date. Or just tell Goblin: "I have maths homework due Friday." It adds it, and ticks it off when you say you finished. Overdue items show in red. Needs memory (Step 4).

## Login quiz (optional)
Add a fun step before the password. Open the menu (three lines, top left), tap **Login quiz**, answer 4 questions (favourite sport, food, best friend, game) and type your password to confirm. From then on, Goblin asks the 4 questions one by one, and then the password. If any answer or the password is wrong, it says only "That did not match" and starts again, so nobody can tell which part was wrong. Capital letters, spaces and punctuation do not matter in answers. Only a scrambled fingerprint of each answer is saved in your database, never the answers. Wrong tries count toward the 15-minute lockout. To change or turn it off, open **Login quiz** again. It needs memory (Step 4) to be on. If you ever forget the answers, open your Upstash database, find the key `ghost:quiz` and delete it.

## Old chats and profile
Tap the **menu button** (three lines, top left). A panel opens with your old chats. Tap one to open it, tap **x** to delete it, or tap **New chat**. The newest 30 old chats are kept. Everything happens instantly on your screen and saves quietly in the background. At the bottom is your profile: tap your name to change it, and use the **Memory** and **Log out** buttons. The picture behind the panel is `public/panel-bg.jpg`. Replace that file to change it.

## Study mode
Tap the small **lamp** in the chat box (next to the paperclip) to turn on **Study mode**. It glows when it is on. Then send a photo of homework or a question. Goblin explains it step by step, asks you one quiz question at a time, and remembers what you find hard so it can practise that again. Turn it off for normal chat. See what it noted under **What I remember**.

## Send screenshots, homework and files

- Tap the **paperclip**, paste a screenshot (Ctrl+V), or drag a file onto the page.
- It works with pictures (a photo of your homework is fine), PDFs and text files (`.txt`, `.md`, `.csv` and code files). For a Word file, save it as a PDF first.
- You can attach up to 4 files, about 3 MB in total per message. Pictures are shrunk for you, so big photos still fit. A long PDF can be too big. Send fewer pages.
- Ask normally, for example "Help me with question 3". For homework Goblin explains step by step, then gives the answer. If a photo is blurry he says so. Take it straight on and in good light.
- Goblin can still see your files when you ask follow-up questions in the same chat, as long as they fit in the size limit.
- Files are not saved anywhere. Only the file names stay in the chat, and **New chat** clears them. Sending big files often uses up your free Gemini limit faster.

## Talk to Goblin (voice)

- When the message box is empty, the send button is a **microphone**. Tap it, speak, and your message is sent when you stop. Goblin answers out loud.
- Tap the **speaker** at the top to make him read every reply aloud, even when you type. Tap it again to turn that off.
- Tap the mic while he is talking to interrupt him. Every reply also has a **Listen** button.
- Spoken answers are short on purpose, one to three sentences. They sound natural, and they use less of your free ElevenLabs text.
- **Voice language:** open the flame panel and look at the bottom. Choose Automatic (your phone's language), English, Hindi or Nepali. This tells the microphone which language to listen for.
- Reading aloud uses the Severin voice if you did Step 6, and otherwise your device's own voice. I can't promise Severin reads Hindi or Nepali well. If it sounds wrong, remove `ELEVENLABS_API_KEY` in Vercel and redeploy, and your device voice is used.
- The first time, your browser asks to use the microphone. Choose **Allow**. If you blocked it by mistake, tap the lock icon next to the address, allow **Microphone**, and reload.
- Listening uses your browser's own speech recognition. It works best in Chrome and Edge, and in Chrome on Android. On iPhone it can be unreliable, especially when Goblin is added to the home screen. If the mic does not work there, type your message instead.

## Connect your apps (optional)

Goblin can send requests to your other apps through one **webhook**. A webhook is a web address that an automation service listens on. Services such as Make, Zapier, n8n or IFTTT can create one, and from there they can reach calendars, spreadsheets, email, notes and more. Check each service's own plan and limits, because they change.

1. In your automation service, create a scenario that starts with a webhook and gives you a web address that begins with `https://`.
2. In Vercel add these variables, then **Redeploy**:

| Name | Value |
|---|---|
| `WEBHOOK_URL` | The `https://` address from your automation service. Keep it secret. |
| `WEBHOOK_DESCRIPTION` | Say what your scenario can do, in plain words. Example: `add events to my Google Calendar and add rows to my Google Sheet "Expenses"` |

3. Ask Goblin: "Add lunch with Sam to my calendar on Friday at 1 pm." Goblin sends your automation this:

```json
{ "action": "add_calendar_event", "details": "Lunch with Sam, Friday 1 pm", "source": "goblin-ai", "sent_at": "2026-11-03T08:00:00.000Z" }
```

Goblin only does this when you ask. A note under the reply ("Sent to your apps: ...") shows what was sent. Your automation decides what to do with `action` and `details`.

To connect an app directly instead, add one tool in `lib/connectors.js` (a description in `declarations()` and one case in `run()`).

## Change what it does (optional)
In Vercel, open your project, then **Settings > Environment Variables**, and add:

| Name | What it does |
|---|---|
| `ASSISTANT_PROMPT` | Tells the assistant who it is. Example: `Your name is Goblin AI. You are my study helper. Explain things simply and quiz me.` (If you set this, include the name again. Memory and app rules are added for you.) |
| `GEMINI_MODEL` | Which Gemini model to use. The built-in default is `gemini-2.5-flash`, but Google now only serves it to projects that already used it. If Goblin says "Gemini does not know the model", set this to `gemini-3.8-flash` (or `gemini-3.5-flash-lite` if that one is slow or runs out). Google changes its free models often. You can see yours at https://aistudio.google.com/rate-limit |

After you change a variable, go to **Deployments**, open the latest one, and choose **Redeploy**.

## Good to know
- What Goblin remembers is stored in your own Upstash database, not in the browser. It is the same on every device.
- Your chat text is saved in your own Upstash database (text only, the newest 200 messages) so every device shows the same chat. **New chat** puts the current chat in your old-chats list and starts an empty one on every device. **Log out** clears it only on that device. Without Step 4 (the database), the chat stays only in each browser. What Goblin remembers stays until you remove it.
- Everything you type, every file you attach, and everything Goblin remembers is sent to Google's Gemini service with each message. Do not type, photograph or say passwords, bank details or other secrets.
- When you talk, your browser turns your voice into text. In Chrome and Edge that usually means your voice goes to Google or Microsoft for a moment. Goblin itself never stores audio.
- Keep the GitHub repository **Private** and never write your key or password inside the code.
- After 8 wrong passwords in 15 minutes, login pauses for 15 minutes.
- If it says "Not set up yet", a variable is missing or too short. Check Step 3.
- If the flame says "off", check Step 4.

## Updating from the first version
If you already have Goblin running: in your GitHub repository choose **Add file > Upload files**, drag in everything from this folder (the `api`, `lib` and `public` folders and the three files), and commit. Files with the same name are replaced. Include `vercel.json`, because voice needs its newest settings. Vercel redeploys by itself and your existing variables keep working. The old `public/avatar.jpg` is no longer used and can stay or be deleted.

## The face / icon
The picture in `public/avatar.png` and the icon files (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon.png`) are cut from the artwork you gave me. It carries an artist's signature. This app is private, but if you ever share the app or the picture publicly, ask the artist first and give credit.

To change the face, replace those files and keep the same names and sizes: `avatar.png` 256, `icon-192.png` 192, `icon-512.png` 512, `apple-touch-icon.png` 180, `favicon.png` 64. `icon-maskable-512.png` (512) is the picture at 80% size on a plain background, so phones can round the corners safely.

## What is inside
- `public/index.html` - the login page, chat screen and memory panel
- `api/auth.js` - login and logout
- `api/chat.js` - sends your messages and your memories to Gemini (checks you are logged in first)
- `api/memory.js` - lists, adds and removes memories (checks you are logged in first)
- `api/speak.js` - turns a reply into speech with ElevenLabs (checks you are logged in first)
- `lib/auth.js` - password and cookie helpers
- `lib/store.js` - talks to the Redis database
- `lib/memory.js` - saving, finding and forgetting memories
- `lib/connectors.js` - what Goblin can do besides talk: memory tools and the app webhook

## Gallery (photos and videos)

Menu, then **Gallery**, then **Add photos or videos**. Everything is saved in your Upstash memory database, so you can open it from any phone or laptop after you log in. Tap a photo or video to open it. **Download** saves it back to the device. **Delete** removes it for good.

You can also add your own songs (mp3, m4a, wav, ogg). Tap a song, then **Play**. Or tell Goblin "play <song name>" and it plays yours first.

The gallery has three sections: **Photos**, **Videos** and **Music**.

**Gallery password.** Tap the gear in the gallery, then set a password (6+ characters). After that, even a phone that is already logged in must type it. It stays open for 2 hours, or tap **Lock** to close it at once. Forgot it? In Upstash, delete the key `ghost:vault`.

**Limits** (the free Upstash database is 256 MB): about 190 MB in total, photos up to 4 MB (bigger ones are shrunk automatically), videos up to 40 MB, songs up to 20 MB.

**Much more space.** In Upstash, move your database to the pay-as-you-go plan (it costs roughly $0.25 per GB per month, check Upstash pricing; set a monthly budget limit there). Then in Vercel, Settings, Environment Variables, add `GALLERY_MB` (for example `20000` for about 20 GB) and, if you want longer videos, `GALLERY_VIDEO_MB` (for example `300`). Redeploy. If you need more room, delete old things.

## Music player (the CD button)

The round CD button in the chat box opens the player. Type a song name and press Play, or just tell Goblin "play ...". It shows the cover, a moving bar, back 10 seconds, pause, forward 10 seconds and volume. The heart saves your favourite part.

- Without a YouTube key it plays a free 30-second preview of the song.
- With the free YouTube key (see the Music section above) it plays the whole song.
- Phones sometimes block music that starts by itself after a chat reply. If nothing starts, tap the play button once.

## Finding the right song

Type the song and the singer together ("Perfect Ed Sheeran"). If Goblin is not sure which song you mean, it shows a short list to tap instead of playing a wrong one. For every song in the world and the full length, add the free YouTube key (see the Music section above).

## Music in the background

While a song plays, your phone or laptop shows the song name, picture and play, pause and skip buttons on the lock screen and in the notification area, and the music keeps going when the screen is off or you open another app.

- Your own uploaded songs and the 30-second previews play in the background on phones.
- Full YouTube songs play in the background on a laptop. On many phones YouTube pauses them when the screen turns off. That is YouTube's rule for free use, and Goblin cannot change it. For music that never stops, upload your own songs to the gallery.
- On iPhone, add Goblin to your home screen first (Share, then Add to Home Screen) for the best result.

## Control your PC and phone
Open the menu, press **My PC**, download the helper, run it on Windows. Then say or type things like "open notepad" or "shut down my PC" (it asks you to tap Confirm first). Android shortcuts show as tap buttons. Full details, limits and safety rules: see `SAFETY.md`.

## Hey Goblin on Windows
Download the helper from **My PC** and run it. A small window opens; say "Hey Goblin", wait for "I'm here", then say a command such as "open Chrome" or "what time is it". See `SAFETY.md` for the limits.

## Making the PC helper even faster (optional)
The helper checks in every 10 seconds when idle (to stay inside the free database plan) and every half second while you use Goblin. If you move Upstash to a paid plan, add `PC_IDLE_MS` = `2000` in Vercel (Settings > Environment Variables) and redeploy, so even the first command answers in about 2 seconds.
