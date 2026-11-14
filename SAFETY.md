# Goblin: device control and safety

## What works today (tested)
| Thing | Status | How |
|---|---|---|
| Windows PC: open apps and websites, lock, type, press keys, close apps, sleep, shut down, restart, cancel shutdown | Works (server side tested; helper script not yet run on a real PC) | Windows helper (`start-ghost-pc.bat`) |
| Android phone: open apps, call, SMS, WhatsApp, directions, alarm, timer, camera, settings | Works as a **tap link** (you tap, the phone does it) | Links shown in chat |
| Emergency stop, disconnect, activity history | Works | My PC |

## Voice: "Hey Goblin" on Windows (needs testing on your PC)
- Runs inside the PC helper. Windows' built-in offline speech recognition listens for "Hey Goblin" on the PC. No audio leaves the PC, and nothing is sent to Goblin until the wake phrase is heard. After that only the words you said are sent as text.
- Goblin speaks the answers with the Windows voice. After an answer it keeps listening for about 6 seconds, so you can ask a follow-up without saying Hey Goblin again.
- Say "stop listening" to turn the wake word off. The window has **Mute microphone** and **EMERGENCY STOP** buttons and shows microphone and connection status. Saying "emergency stop" also works.
- Dangerous actions (shut down, restart, sleep, close an app, typing) need a click on Yes in a box on the PC. A voice "yes" is never accepted, so audio from a video or TV cannot approve anything.
- Limits: the microphone is the Windows default one (change it in Windows Sound settings). Windows' wake detection is not as good as a dedicated wake-word engine, so it may miss you or react to similar words. Low-risk commands such as opening an app could be triggered by someone else's voice or a video saying "Hey Goblin".
- Not tested on a real Windows PC yet. The server side and the helper's logic were tested with pretend servers; the microphone and window parts need your PC.

## Speed and custom shutdown
- Shutdown and restart now wait **2 seconds** by default. Say "shut down in 5 seconds" or "shut down in 10 minutes" to pick the delay (0 seconds to 1 hour). It still asks for Confirm first, and "cancel shutdown" works while it counts down.
- Simple commands ("open notepad", "lock my pc", "shut down in 5 seconds", "close chrome", "volume up") skip the AI and run at once. Anything else goes to the AI.
- The helper checks every 10 seconds when idle, and every second for 3 minutes after you open Goblin, start typing or give a command.

## More PC control (added)
Open any installed app or website, close apps, maximize or minimize the current window, snap left or right, task view, full screen, new window, close the current window (asks first), take a screenshot (Windows saves it in Pictures > Screenshots), set brightness (laptops), open Downloads/Documents/Desktop/Pictures/Music/Videos, and list what windows are open.
Deliberately NOT included: running any typed command, moving or clicking the mouse blindly, deleting files, and watching your screen. Goblin cannot see your screen, so blind clicking could press the wrong thing. If you want a "run a command" action later, it should always show you the exact text and need your click on Yes.

## Not supported (and Goblin will say so)
Reading notifications, calls or messages; sending messages without your tap; iPhone control; Smart TVs; Mac and Linux PCs; always-on wake word on the phone (needs a real Android app, not built yet); brightness, volume, screenshots; secret camera or microphone access (never).

## Safety rules built in
- Only a PC you paired with a secret key can be controlled. **Disconnect** makes a new key; old helpers stop working.
- Only a fixed list of actions and keys is allowed. Everything else is refused.
- **Low** risk (open app/site, lock) runs at once. **Medium** (close app, type, sleep, some keys) and **High** (shut down, restart) always wait for a real tap on **Confirm**. Each Confirm works once and expires in 2 minutes.
- Goblin only acts on your own typed or spoken message, never on pasted text or attachments.
- Goblin shows the real result from the PC. If the PC did not answer, it says so and never claims success.
- **Emergency stop** blocks everything, clears waiting commands and cancels a pending shutdown.
- Every action is listed in My PC > Activity.
- Wrong helper keys are rate limited (30 tries, then 15 minutes lock).

## Architecture
Browser/voice -> `/api/chat` (Gemini tools `control_pc`, `open_on_phone`) -> `lib/device.js` (risk check, queue in Upstash) -> PC helper polls `/api/device` with its key, runs the action, reports back.

## Roadmap
Mac/Linux helpers, notification access through an Android app, TV integrations.

## Voice: "Hey Goblin" on Android (written, NOT built or tested yet)
- The `android/` folder holds a Kotlin app. GitHub builds it (Actions tab > Build Goblin Voice app) into an APK you install by hand.
- A foreground service with a visible notification (Mute and Stop buttons) listens for "Hey Goblin" using an offline Vosk model inside the app. No audio leaves the phone. After the wake phrase, only the words you said are sent to Goblin as text, with the phone's own secret key (separate from the PC key; it can talk to Goblin, confirm or stop, but cannot pick up PC commands).
- Dangerous PC actions asked for by voice show a notification with Yes / No buttons on the phone.
- "Open Instagram" and similar: the app opens it directly only if you allow "display over other apps". If not, it shows a notification you tap. Calls open the dialer and messages open the message app; you press Call or Send.
- Limits: Android may stop the app to save battery (Samsung, Xiaomi, Oppo, Huawei are strict), force stop or a restart ends it until you press Start, and it does not start by itself at boot. Wake detection quality of the small offline model is modest. Not tested on any real phone yet: the first build may fail and need a fix.
