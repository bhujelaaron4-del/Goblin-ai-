# Ghost Voice (Android)

A small Android app that listens for "Hey Ghost" on the phone and talks to your Ghost.

- The wake word and the speech are understood on the phone by an offline model (Vosk, Apache 2.0, free, no key).
- Only the words you say after "Hey Ghost" go to Ghost, as text.
- It runs as a foreground service with a notification that has Mute and Stop buttons.

Built by GitHub Actions (`.github/workflows/android.yml`). Not tested on a real phone yet.
