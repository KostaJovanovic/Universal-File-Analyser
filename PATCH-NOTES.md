# Analyser - Patch notes

_Every update on this local branch since the 18 June split (base commit `55c1f4e`), newest first - 70 commits, written in the site changelog style. Not yet on `origin/main`._

## 6.06 - 6.07 - Guard Rails
*10 July 2026, 23:53*

- **A broad robustness and safety pass across the whole workbench: Analyser now shrugs off malformed or hostile files, keeps every preview inert, tidies its memory use, and - in the desktop app - only ever reads the file you actually drop.**
- `Fix` **Sturdier against broken or hostile files.** A corrupt or deliberately crafted file could previously lock up the tab while Analyser tried to read it. A wide sweep across the file readers - several data formats, plus 3D and game files - now stops cleanly the moment something does not add up, so a bad file fails quietly instead of freezing the page.
- `Fix` **Previews stay inert.** Previews of notebooks, e-mail, presentations, documents, drawings, maps, diagrams and vector images are now more strictly sanitised, so nothing embedded in a file you open can run or quietly reach out to the network. The no-upload promise is unchanged - this simply closes the door from the other side too.
- `Fix` **One file at a time.** Dropping several files onto the page at once now analyses the first one cleanly, instead of rendering them on top of one another.
- `Fix` **A clear message when a viewer trips.** If a file’s viewer hits an unexpected error, Analyser now shows a plain error - with the file’s fingerprint still available - rather than a near-empty result that looked like it had succeeded.
- `Fix` **Very large files bow out gracefully.** Opening an enormous archive, G-code file or similar no longer risks crashing the tab: past a sensible size Analyser declines and tells you why.
- `Fix` **Offline features are more dependable.** The **Download for offline use** cache and the anonymous “a file was analysed” count now survive updates and reloads reliably, and a freshly updated version is no longer shadowed by an older saved copy.
- `Fix` **Lighter on memory.** Preview images and players across many formats now release their memory once they are no longer on screen, so a long session of analysing file after file stays lighter.
- **The high-score board is just for fun.** The Asteroids leaderboard is now clearly marked as unverified - scores are submitted by players and not checked - so it reads as the bit of fun it is.

**Desktop app**

- `Fix` **The desktop app only reads what you drop.** The **Windows**, **macOS** and **Linux** app now reads only the exact file you drag onto it, never any other file by path - so the desktop version holds the same tight boundary as the website.

## 6.0 - 6.05 - Unmix  ·  milestone
*10 July 2026, 19:31*

- **Sixth milestone: Analyser pulls a song apart. A neural network splits any track into separate vocal and instrumental parts, right on your device, and a slider under the spectrogram fades between them while the picture morphs in real time. A lighter model joins for phones, the tool gets easier to use across the board - and Analyser arrives as a full desktop app.**

**In the browser**

- `New` **Split a song into vocals and instrumental.** The Sound analysis spectrogram’s **Isolate** panel gains a **Separate** tool that runs a neural network - the MDX-Net “Kim Vocal 2” model from Ultimate Vocal Remover - entirely in your browser, on your graphics card where the browser supports it, to separate a track into a clean vocal stem and a backing-instrumental stem. Nothing is uploaded; the model downloads once (~85 MB, part of the Complete offline download). Each stem gets its own player, an **Analyse** button to open its spectrogram, and a **Download WAV**.
- `New` **Fade between the voice and the backing track, live.** A **Vocals** · **Instrumental** slider sits right under the spectrogram: drag it and the view morphs in real time to the exact mix you choose, while playback crossfades what you hear. It stays truthful - the real frequencies of the blended sound, not a trick - and a centre mark snaps back to the normal mix. The play control under the spectrogram plays your chosen blend, with every scrubber kept in step.
- `New` **A lighter model for phones.** The **Separate vocals (AI)** tool now offers two models: **Standard** - the cleanest separation, about 85 MB - and **Lite**, about half the download and lighter to run, for phones and slower machines. The narrow mobile layout picks **Lite** by default. Both run entirely on your device.
- `New` **Choose the model each time.** Clicking **Separate vocals (AI)** now opens a short prompt to confirm - and switch between **Standard** and **Lite** - before anything runs, with the prompt updating live as you change your pick. The button is a plain on/off toggle: click it again to clear the separated parts and return to the original track.
- `New` **Isolate now shapes the separated parts.** The spectrogram’s **Isolate** presets and manual frequency bands now apply to the AI vocal/instrumental **blend** as well - previously the separated parts played straight through, ignoring your filters - and the blend plays on its own audio path, so it starts cleanly instead of over the original track.
- `New` **The blended view honours your spectrogram settings.** As you drag the **Vocals - Instrumental** slider the picture updates smoothly, and the moment you settle it - or change the **FFT**, **window** or mode - the blended spectrogram is recomputed at those exact settings, so it stays as truthful as the file’s own.
- `New` **A loading screen.** Opening Analyser now shows a brief branded splash that fades away the moment the app is ready, matching the site’s look and your light or dark theme.
- `New` **Choose your offline extras.** The **Complete** offline download now opens a small chooser so you can add just what you want on top of the **Everything** download: reading text in **30+ languages** and the **AI vocal separation** model are separate picks, so you need not pull one to get the other. All three download descriptions were refreshed to match.
- `New` **Full camera controls for 3D models.** The 3D model viewer gains the same on-canvas camera stack as the G-code preview: a press-and-hold **+ / -** zoom pad, a **scroll-to-zoom** toggle - off by default, so the wheel still scrolls the page until you turn it on - and a **fullscreen** button, all of which stay put in fullscreen.
- `New` **A tidier samples gallery.** The samples page now leads with a small curated set of example files and tucks the rest behind a **+ More** reveal, so it is less overwhelming on first load - especially on a phone - with the full set one tap away.
- `Faster` **The AI model is kept for a day.** Once downloaded, the chosen model is stored for 24 hours, so reloading the page - even a hard refresh - no longer re-downloads it.
- **Your count survives going offline.** The single anonymous “a file was analysed” tick now banks itself when you have no connection and sends once you are back online, so the running total stays accurate even when you work on a plane. Nothing about the file is ever sent - only its extension and whether it was supported, never the name, size or contents.
- `Fix` **The spectrogram playhead keeps up.** The white marker now tracks your cursor exactly as you scrub across the spectrogram, instead of easing in a step behind.
- `Fix` **A new file silences the last one.** Analysing a new file now stops any sound still playing from the previous one - including the AI blend, a reversed clip or a sonified image, which play through the audio engine directly and used to carry on underneath.
- `Fix` **Clearer headings and readouts.** The small `[?]` hints in section headers now sit next to their heading instead of drifting to the middle, and the spectrogram’s **Analysis** figures - peak, detected range, cutoff, dynamic range and resolution - moved into the **File info** card as a standard readout table, each with its own `[?]`. The multi-channel picker also sits directly above the spectrogram it drives.
- `Fix` **The volume popup stays put.** On the audio and video players, sliding from the volume button up to the slider no longer snaps the popup shut before you reach it.
- `Fix` **The offline picker closes cleanly.** The **Download for offline use** feature chooser no longer leaves an invisible layer behind after you close it - on some phone browsers that layer kept quietly swallowing taps until you reloaded the page.
- `Fix` **Sharper accessibility and a steadier footer.** With high-contrast mode on, the page background now sits a clear step off the card colour so panels read as distinct cards, and opening the footer’s open-source **dependencies** list no longer nudges the Install and Clear buttons around.
- **Tidier Isolate controls.** The frequency presets, custom bands and the new AI separator are grouped into clear, labelled sections, the **Isolate** button now matches the other controls instead of carrying a red outline, with a divider before **Save PNG**, and the model prompt was redrawn to sit with the rest of the site.

**Desktop app**

- `New` **Analyser is now a desktop app.** As well as the website, Analyser is now a native desktop app for **Windows**, **macOS** (Apple Silicon and Intel) and **Linux**, built from the exact same code and running the same on-device engine - nothing is uploaded there either. It installs like any normal app, works fully offline (the AI, video and 3D engines are bundled in) and updates itself in the background. Downloads are on the GitHub releases page.

## 5.16 - 5.21 - Side by Side
*10 July 2026, 01:41*

- **A new /compare page lines up two files side by side, and the sound workbench gets much stronger - push a too-quiet clip past full volume, solo the vocals, bass or drums (or drop the lead vocal) and save the result as a WAV - alongside large-archive and touch fixes and a fact-checking pass across the format guide.**
- `New` **Compare two files side by side.** The new Compare page takes two dropped files - two photos, two documents, two archives, anything - and runs each through the full analysis, merging the results into one table per section so every field, hash and date lines up next to its counterpart, with a **Show differences** toggle to narrow the view to only what changed. Every compared file gets its full fingerprint card even when its own viewer would not normally build one, and a loading indicator shows while both files analyse.
- `New` **Turn a quiet clip up past 100%.** The volume control on every audio and video player now opens a slider that reaches up to **225%**, for recordings that are simply too quiet at full volume. A built-in limiter keeps the boosted sound from distorting - it lifts the loudness you actually hear rather than just clipping the peaks. Volume always starts back at 100% on a fresh visit, so a boost can never silently follow you to the next file.
- `New` **Solo the vocals, bass or drums.** The Sound analysis spectrogram’s **Isolate** tool gains one-tap **Vocals**, **Bass** and **Drums** presets that keep just that part of the mix, plus a **Remove vocals** option that cancels a centred lead vocal on a stereo track. They only approximate - instruments share frequencies - but need nothing downloaded and work on any file. A **Download WAV** button then renders the whole clip through the exact bands and presets you have set, so you can keep the muted, soloed or vocal-free version as an audio file.
- `Fix` **The spectrogram brightens as you boost.** Pushing a quiet clip louder now lifts the spectrogram’s sensitivity to match, so the picture brightens along with what you hear, and the sensitivity slider gains a click-to-reset mark at its 100% default.
- `Fix` **Large archives list everything.** A big ZIP whose internal file index sits far into the file - the case with archives past a few gigabytes - now has that index read in full, so every entry is listed instead of the browse coming up short.
- `Fix` **Stats charts respond to touch.** On the stats page, tapping a bar or point on a phone now shows its exact figure - the same read-out a mouse hover gives on a desktop.
- `Fix` **Smoother G-code tool highlight.** On a multi-tool G-code build, switching which tool is highlighted now cross-fades the others smoothly instead of snapping between full and faded, and every tool eases back to full once playback finishes. A build also defaults to a fixed 30-second run through the whole job rather than real time, so long pauses or slow feedrates no longer leave the preview crawling; real-time playback is still there as a choice.
- **Every dependency now shows its licence.** The footer’s open-source credits gain a small **licence** link beside each library, so you can read the exact terms behind every part the workbench is built on.
- **Maintenance.** The per-format guide pages had a fact-checking pass - dozens of wrong dates, attributions and self-contradicting facts corrected, duplicate facts reworded, and every file type, including every variant of an ambiguous extension, now carrying at least three verified “Did you know” facts - and they gain the full page navigation the rest of the site has. A large part of the app’s core was also split into smaller modules behind the scenes.

## 5.15 - Sharp Lines
*8 July 2026, 02:51*

- **A recorded G-code build clip now looks sharper - it exports at a higher bitrate by default, with a new quality choice for when you want even more.**
- `New` **Choose the clip quality.** The G-code **Export clip** panel gains a **Quality** setting - **Standard**, **High** or **Max** - so the thin toolpath lines stay crisp instead of turning soft, with the estimated file size updating as you choose. It now defaults to the higher setting, and the old “Quality” control that actually set the resolution is renamed **Resolution**.

## 5.14 - Cross Check
*8 July 2026, 02:38*

- **A wide compatibility pass so more of the workbench works outside Chrome - Office, e-book and comic files open on older browsers, PDF and document zoom works in Firefox, and the 3D and G-code viewers stop blanking out - plus a CRC-32 checksum on every file.**
- `New` **CRC-32 on every file.** The integrity panel’s **Show more hashes** now adds a **CRC-32** checksum - the same one ZIP, PNG and gzip use, and what `.sfv` files store - beside MD5, SHA-1 and SHA-512, for matching against checksum files.
- `Fix` **Office, e-book and comic files open on older browsers.** Word, Excel, PowerPoint, ODF, EPUB and comic archives now open on older Safari, Firefox and Chrome that lacked the built-in unzipper Analyser relied on - it falls back to a bundled one instead of failing to open.
- `Fix` **Zoom works in Firefox.** Double-click and double-tap zoom in the PDF and document viewers now works in Firefox, which does not support the zoom method the other browsers use.
- `Fix` **The 3D and G-code viewers stop going blank.** Opening several G-code or 3D models in a row, or toggling their quality, no longer exhausts the browser’s graphics contexts and leaves a later viewer blank - each viewer releases its context when you move on.
- `Fix` **Some HEVC video plays in Firefox.** A raw or recovered HEVC/H.265 clip is now re-encoded when the browser cannot decode it - Firefox has no HEVC support - so it plays instead of showing black.
- `Fix` **Gentler on phones.** A very large comic, DjVu scan or database now shows a clear notice on a phone instead of trying to open it and crashing the tab; big spectrograms and JPEG 2000 images also stop rendering blank at their size limits.
- **Safari and iOS groundwork.** The frosted-glass labels, PDF text selection, home-screen install and audio playback all pick up Safari-specific fixes under the hood.

## 5.13 - Now Playing
*8 July 2026, 01:49*

- **Files your browser refuses to play on its own now play anyway - an unusual camera video is offered as a one-tap conversion instead of a black screen, and audio it cannot decode is rebuilt so it is no longer silent - alongside a batch of viewer fixes.**
- `Fix` **Video the browser cannot decode gets a way in.** A clip in a professional camera format - such as Sony 4:2:2 footage from an FX30 - is now recognised as one the browser cannot play and offered as a **Convert to H.264** button that turns it into a standard 8-bit video on your own device, instead of loading a black player.
- `Fix` **Audio it cannot decode is no longer silent.** When the browser lacks the decoder for a sound file - some AAC, and many older or exotic codecs - Analyser already rebuilds the waveform; now it plays that rebuilt sound too, so files that used to load without any audio actually play.
- `Fix` **Tidier PDF previews.** A wildly long PDF page no longer stretches down the screen - each page preview is capped to a page shape and scaled to fit - and the “show more pages” button hides once there are none left.
- `Fix` **Drag a PDF page to move it.** With a page open you can now grab it and pan with the cursor, and a page that already fits no longer scrolls sideways for no reason.
- `Fix` **G-code tools fade back in.** At the end of a recorded G-code clip, tools that were dimmed to highlight the active one now ease smoothly back to full strength instead of snapping.
- `Fix` **Grab the After Effects timeline scrollbar.** The scrollbar under a long After Effects timeline can now be dragged directly, instead of the timeline sliding along underneath your grab.

## 5.12 - Band Stop
*7 July 2026, 07:41*

- **The sound workbench gets sharper - mute frequencies you pick straight on the spectrogram, watch every image-to-sound setting reshape the picture live, and see below 20 Hz for the first time - while a recorded G-code clip now spends its time on the real build instead of the machine setting up.**
- `New` **Mute the frequencies you choose.** The Sound analysis spectrogram gains an **Isolate** mode - drag across the spectrogram, or type an exact low and high frequency, to pick one or more bands, and each one is muted from playback and shaded on the view. So you can lift out a hum, a whistle or a whole range and hear what is left. Bands that overlap block cleanly now, with no sound leaking through the seams.
- **Keep scrubbing while you isolate.** You can still move the playhead - grab it, or tap the spectrogram to seek - while marking out frequency bands, so picking ranges and listening no longer fight each other.
- `New` **See what your picture will sound like.** In Image to sound, every setting that shapes the sound now redraws the picture live - invert, the colour channel it reads, the colour scheme, the dB scale and gamma all repaint the preview as you change them, so you can read the loudness map before you render. A new **[?]** explains each control, an **Analyse WAV** button runs the full sound analysis without playing, and the Invert and dB switches now match the rest of the controls.
- `Fix` **The spectrogram reaches below 20 Hz.** The sound spectrogram now extends down to 10 Hz, so very low bass and infrasound that used to drop off the bottom of the chart are visible - in the file view and the live spectrograms alike.
- `New` **A G-code clip that gets to the point.** A recorded G-code build clip now rushes its first few setup moves past in the opening second, so the rest of the clip is spent watching the real object draw itself rather than the machine homing and priming. The label and site mark shown on the clip are a little larger and easier to read too.

## 5.11 - Render First
*7 July 2026, 03:40*

- **Every file now leads with the real thing - the render, preview or file tree first and the technical details below - a recorded G-code build saves as a clip you can share anywhere, including WhatsApp, and the After Effects project timeline is rebuilt with true layer timing, real label colours and a frame-snapping scrubber.**
- `Fix` **The render comes first.** Across every viewer, the actual result - a rendered web page, a document preview, an archive’s file tree, a spectrogram - now sits at the very top of the report, with the file’s technical details beneath it, so you see the file itself before its fingerprints.
- `Fix` **Clips you can share anywhere.** A recorded G-code clip now plays and sends far more widely - including on WhatsApp and social apps - by saving in a broadly compatible video format instead of one some apps refused to open.
- `New` **Set the clip speed exactly.** The **Export clip** panel now offers recording speeds in lines per second, plus fields to type an exact duration or lines-per-second, alongside the length presets.
- `Fix` **The export panel fits your phone.** On a phone the Export clip settings now fill the screen with a close button in the corner, instead of running off the bottom out of reach.
- **Sound leads with its spectrogram.** The Sound analysis now opens with the interactive spectrogram at the top and the channel picker directly beneath it.
- `Fix` **After Effects timelines read true.** An After Effects project timeline now places every layer at its real position - trimmed clips that used to pile up at the start spread across the timeline exactly as they sit in After Effects - and it drops the hidden camera-view rows that were being counted as layers.
- `New` **Layers coloured and marked like After Effects.** Each layer takes its real After Effects label colour, with a glyph naming its kind - text, shape, image, video, audio, pre-comp, solid, camera or light - so the timeline reads at a glance.
- `New` **Scrub an After Effects timeline.** Hovering the timeline now draws a guide line that snaps to the nearest frame and shows its timecode and frame number in a small readout.

## 5.10 - Take One
*7 July 2026, 00:43*

- **A G-code build can now be recorded as a video - the object drawing itself on from the first move to the last - and downloaded to keep or share.**
- `New` **Record a build as a video.** The G-code viewer gains an **Export clip** button that renders the whole build as an MP4 - the toolpath drawing on move by move while the camera slowly orbits - with a panel to choose the length, frame rate, aspect (landscape, portrait or square), quality and which camera and scene extras to include. It renders faster than real time, entirely on your own device.
- `Fix` **A cleaner “dim other tools”.** On a multi-tool print, fading every tool except the one currently printing no longer makes dense areas and the outline bloom into a glow - the faded tools recede cleanly instead.

## 5.09 - Close Up
*6 July 2026, 15:50*

- **The G-code and 3D viewer gains proper zoom controls and a tidier fullscreen.**
- `New` **Zoom in without a mouse wheel.** The G-code viewer adds a **+ / -** zoom pad you can press and hold to ride the camera in or out, and a scroll-zoom toggle so the wheel zooms the model only when you turn it on - otherwise the wheel scrolls the page as usual.
- `Fix` **Fullscreen keeps the controls in reach.** In fullscreen the viewer now starts with the canvas filling the screen and the controls collapsed to a slim bar, with a **More controls** button to expand them - and the zoom and exit buttons always ride on top of that bar instead of hiding behind it.

## 5.08 - Any File
*6 July 2026, 13:15*

- **The home page becomes a single “drop any file” zone, and multi-channel sound can be analysed one channel at a time.**
- `New` **One dropzone for everything.** The home page now leads with a single **drop any file or folder** zone - photos, sound, video, PDFs, archives, folders and every other format go through the same target - with **Record sound** and **Live spectrogram** a click away, in place of the three separate cards.
- `New` **Pick a channel to analyse.** A stereo or surround sound file now lets you choose which channel drives the spectrogram and waveform - the mix, or any individual channel, each labelled by its speaker position - instead of always merging them to mono.
- `New` **Analyse an image found inside a file.** Pictures carved out of another file now carry an **Analyse** button that runs the full photo tools on the extracted image, and the photo **Sonify** tool previews its Gamma curve on the image live as you drag it.

## 5.07 - Living Type
*4 July 2026, 10:00*

- **Variable fonts come alive again - their weight, width and other adjustable traits can animate on their own - there is a real variable font in the samples gallery to try it on, the live specimen now leads the font report, and a wider slice of the app is available for offline download.**
- `New` **Watch a font move.** Open a variable font (.ttf / .otf) and each adjustable trait - weight, optical size, softness and the rest - now has a play button that gently sweeps it back and forth, so you can watch the letters breathe rather than nudge a slider by hand. A **Play all** control animates every axis at once, each glides on from wherever you left its slider, and dragging one by hand stops just that one.
- `New` **A variable font to try it on.** The Samples gallery gains **Fraunces**, an expressive variable serif, so you can open a real one in a click and morph its weight, optical size and softness live. It travels with its open-source licence.
- `Fix` **The specimen leads.** The live font preview now sits at the top of the report, above the file’s technical details, so the real rendering is the first thing you see - and the axis sliders now match the rest of the workbench.
- **More of the app, offline.** The **Everything** download now also bundles EPS and PostScript graphics, AutoCAD drawings, STEP and IGES CAD models and the whole sample gallery, so more formats open with no connection at all.

## 5.05 - 5.06 - Sound Vision
*1 July 2026, 22:00*

- **Analyser can now turn a picture into sound - read any photo, or a real spectrogram, as a recipe for audio, play and scrub it against the image, run the whole sound workbench on the result, and save it. You can also keep what you record.**
- `New` **Hear a picture.** Open a photo and the Sound section now offers to **Sonify** it - reading the image as a spectrogram, where left to right is time, top to bottom is pitch and brightness is loudness, and resynthesising it as sound. Choose how the sound is built, set the pitch range and length, then press play - a line sweeps across the picture in step with the audio.
- `New` **Play a real spectrogram back.** Drop an actual spectrogram image and Analyser can invert it to recover the sound it depicts, with presets for the common colour maps. An **Invert** switch handles pictures drawn dark on light, so a printed or hand-drawn spectrogram sounds the right way round.
- `New` **The whole sound workbench, on the result.** Once a picture is sonified it runs straight through the full Sound analysis - interactive spectrogram, waveform, level and loudness stats, pitch and tempo - with a download to **WAV**. The length runs to three minutes, or click the number to type any duration you like, and a progress bar tracks the render.
- `New` **Keep what you record.** After recording from the microphone or capturing the live spectrogram, a **Download** button now saves the captured sound, so a take you have just analysed is no longer lost when you leave the page.

## 5.04 - Three Tiers
*28 June 2026, 02:39*

- **Analyser now says plainly how deeply it can open each format - a new “Partial” tag for files it can only preview - the circuit-board 3D view gains pinch-zoom and two-finger pan on phones, and a couple of report cards move to where they belong.**
- `New` **See how deeply a format opens, at a glance.** Every format now carries one of three tags - **Full**, **Partial** or **ID** - so you know before you drop a file whether it opens in a complete viewer, shows only the preview and details baked inside it, or is simply identified. Files like Photoshop, Illustrator, Fusion 360, SolidWorks, Apple iWork and Krita - which only give up an embedded preview - are now honestly marked **Partial**, on the format list, the samples gallery and each guide page, which spells out what you do and do not get.
- `New` **Pinch and pan a circuit board on your phone.** The 3D view of a KiCad board now zooms with a pinch and pans with two fingers, the way the mouse wheel and right-drag already worked on a computer, so you can lean right into the copper on a touchscreen. Double-tap glides the view smoothly back to where it started.
- `Fix` **Board part lists fit the screen.** On a phone, a circuit board’s bill of materials no longer stretches the page wider than the screen - long part numbers and footprint paths wrap, and a wide table scrolls within its own card.
- `Fix` **The findings that matter lead.** A video’s reverse-playback option and the note about data hidden after a file’s end now sit lower in the report, just above the file’s fingerprints, instead of pushing the main analysis down - and that hidden-data note is no longer dressed as a red alert, since it is worth knowing but is not a failure.

## 5.01 - 5.03 - Forensic Sweep
*27 June 2026, 18:30*

- **Analyser sharpens into a forensic toolkit and opens more of what you drop: it maps where a file’s data turns random, pulls hidden files back out, spots edited photos and tampered timestamps, traces a PDF’s scripts, plays Lottie animations and opens FBX models, and signs off its reports so anyone can verify them.**
- `New` **See where a file turns random.** An unknown file now gets a colour strip charting how random each part of it is - flat, high regions point to compressed, encrypted or packed data, and a sudden step marks the seam where one kind of content gives way to another.
- `New` **Pull a hidden file back out.** When data is tacked on after a file’s real end - a smuggled archive or image - you can now extract it with one click or open it in place, so an archive hidden behind a JPEG opens straight into the archive browser.
- `New` **Network indicators, gathered.** URLs, IP addresses, domains and email addresses found inside a document, script or config file are now listed together, each with one-click lookup links to public reputation services. Nothing is sent until you choose to click.
- `New` **Catch a tampered date.** A photo or PDF is now checked for impossible timestamps - a date in the future, a file last saved before the photo it holds was taken, or a modification dated before the original - and warns when a file’s history does not add up.
- `New` **Spot a cropped photo.** The small preview a camera tucks inside a JPEG is now compared to the full image; when their proportions no longer match it is flagged as a sign the photo was cropped or edited after it was taken.
- `New` **See what a PDF’s scripts do.** Embedded PDF JavaScript is now laid out by what triggers it - on open, on print, on save - with the scripts that run automatically called out, and a scan that flags code reaching the network, touching files, launching programs or hiding itself.
- `New` **Photoshop layers, in full.** A .psd now lets you save any layer as a PNG, and flags the layers carrying content you cannot see in the flattened image - switched off, fully transparent, or collapsed to nothing - a common place to stash a watermark or an earlier draft.
- `New` **Office files give up more.** Word documents flag “ghost authorship” when the last editor is not the original author and break down who made which tracked changes; Excel lists its pivot tables and their sources; and PowerPoint and the old .doc / .xls / .ppt files are now checked for macros and links pointing to outside servers.
- `New` **Query a database in place.** A SQLite database now offers a query box to run your own read-only SQL against a copy of it, right in your browser, alongside the schema and sample rows it already showed.
- `New` **Subtitles the way they look.** Advanced SubStation Alpha subtitles (**.ass** / **.ssa**) now render with their real styling - colours, bold, italics and line breaks - on a dark stage, with a table of every style the file defines, instead of a plain list of lines.
- `New` **Play a Lottie animation.** A Lottie or Telegram sticker animation (**.lottie**, **.tgs**, or a Lottie .json) now plays live with a timeline you can scrub, plus play, pause, speed and loop controls - not merely identified.
- `New` **Open an FBX model.** An Autodesk **.fbx** model - from Blender, Maya, Unreal and most 3D tools - now opens in the interactive 3D viewer, reading its mesh from both the binary and text forms of the format.
- `New` **Reports you can verify and print.** The exported analysis report now leads with a verification block - the file’s SHA-256, size, a UTC timestamp and the Analyser version, with instructions to re-check the hash - and a new **PDF** option prints the whole report straight to a PDF.
- `Fix` **Web pages preview properly.** The rendered preview of an .html file now lays the page out at a real browser width and scales it to fit, instead of cramming it into the panel and breaking the layout, with a **Desktop** / **Mobile** switch to see a responsive page either way.
- `Fix` **G-code display settings stay as you set them.** Switching a render-quality option in the G-code viewer no longer resets “dim other tools” or the build-plate view - what you had showing stays showing.
- **Polish** - the Samples button is highlighted in the navbar and its example runs never trigger the share prompt, the stats graph opens on the cumulative view and reshapes to stay readable on a phone, the export panel lays its options out two-by-two and fits within the height of the screen, and the G-code viewer’s “dim other tools” button shortens to fit when space is tight.

## 5.0 - Machine Shop  ·  milestone
*25 June 2026, 20:55*

- **The fifth milestone. Analyser learns to bring broken files back from the dead, opens professional CAD straight from Fusion 360 and SolidWorks, lets you try the whole workbench on a gallery of built-in example files, and sharpens its 3D, colour and forensic tools throughout - the largest release since the workbench stepped into 3D.**
- `New` **Rescue a broken photo.** A truncated, cut-off or corrupt photo that no viewer will open can now be salvaged - Analyser repairs a half-written JPEG, PNG or HEIC, rebuilds a damaged JPEG’s header from a working reference shot, and carves any photos buried inside an unknown file back out.
- `New` **Recover an unfinished video.** A video cut off mid-recording - a camera that lost power, a transfer that stopped - with no index left to play it by is now rebuilt frame by frame, borrowing the missing setup from the clip itself or from a reference video, and played back in place.
- `New` **Autodesk Fusion 360 designs open.** A Fusion 360 design (.f3d) or archive (**.f3z**) now opens to the thumbnail Fusion rendered into it - shown as the model - alongside what kind of document it is (part, assembly, drawing or sheet metal), the Fusion version that saved it, and how many solid bodies it holds. The editable geometry stays Autodesk’s own, so export to STEP, STL or 3MF for the full 3D viewer.
- `New` **SolidWorks parts, assemblies and drawings open.** A SolidWorks part (.sldprt), assembly (**.sldasm**) or drawing (**.slddrw**) opens too: older files give up their saved preview image and document details - title, author, and who last saved it and when - while files from SolidWorks 2015 onward, which Dassault encrypts end to end, are identified on sight. Export to STEP, STL or 3MF for the interactive 3D view.
- `New` **Try it with built-in examples.** A new **Samples** gallery offers a spread of example files - photos, audio, video, 3D models, a circuit board, G-code and more - that open in a single click, so you can see what Analyser does with no file of your own. Each tile shows its file type at a glance, hovering one reveals a plain-language note on the format, and they are sorted into a tidy grid by kind. They are sandboxed: never counted, never recorded.
- `New` **Colour looks, not just tables.** Alongside colour look-up tables (.cube), Analyser now opens Adobe SpeedGrade and Iridas **.look** files - reading the full grade stack (basic correction, tints, wheels, curves, secondaries and vignette) and visualising the baked-in LUT it carries. Every LUT is shown applied to a sample photo straight away, before and after, so you can read the look at a glance.
- `New` **3D models stand the right way up.** An STL, 3MF, AMF or STEP/IGES model now opens upright instead of lying on its side, with a one-tap **Z-up / Y-up** button to flip whichever way a particular file expects.
- `New` **Multi-tool prints, tool by tool.** A multi-material or tool-changing G-code print now marks the active tool with its own shaped, colour-coded toolhead - numbered, and changing the instant the machine swaps tools - so you can follow which tool laid down which part, while the follow-the-head camera holds the toolhead dead centre as the print plays on.
- `Fix` **G-code playback pauses where the print does.** The G-code player honours dwell commands, manual pauses and heat-up waits - the head holds still exactly where the real machine would - and plays at true speed by default.
- `New` **Zortrax prints recognised.** A Zortrax Z-SUITE compiled print (**.zcode**) - the sliced, machine-ready job sent to a Zortrax 3D printer - is now identified on sight.
- `Fix` **Archive contents come first.** Open a .zip and the visual treemap of what is inside now sits at the top, above the integrity and timing panels, so you see the shape of an archive before its fingerprints.
- **Polish** - the new Fusion 360 and SolidWorks viewers take their place in the engineering format guides, Zstandard-compressed archives are handled, and a wide sweep of viewer, layout and recognition fixes lands across the workbench.

## 4.17 - Split Personality
*24 June 2026, 05:18*

- **Extensions that quietly stand for several unrelated file types now get a guide page that explains each one on its own, the folder scanner judges files by what is inside them rather than their name, more developer and phone formats are recognised, and a photo’s sharpness score is fairer.**
- `New` **One extension, many file types - told apart.** Some extensions are shared by completely unrelated formats - a **.pkg** is a macOS installer or a Destiny game package, a **.key** a Keynote slideshow or an encryption key, a **.map** a linker map or a game level. Their guide pages now carry a separate, self-contained card for each meaning - its own description, a note on how to tell them apart, and its own “Did you know” - so a search for one lands on the right one. Twenty-three such extensions are covered.
- `New` **The folder scanner reads contents, not just names.** When you check a folder for openable files, Analyser now identifies each one by what is actually inside it - so a misnamed or extensionless file it can still read counts as openable, and a file that is genuinely unreadable is flagged, instead of trusting the name alone.
- `New` **Destiny game packages recognised.** A Destiny or Destiny 2 **.pkg** - Bungie’s Tiger engine - is now told apart from a macOS installer of the same name, reading its package id and build date.
- `New` **More developer and phone formats.** Interface definitions (**.idl**), classic ASP pages, pkg-config files (**.pc**), GPU shaders and project templates are now recognised, alongside Android extras - Google Camera settings, Samsung Secure Folder encrypted items and phone backups, and Android game data packs (**.obb**) - each with its own guide page.
- `New` **A fairer photo sharpness score.** The sharpness reading for a photo now measures focus on its own terms instead of being thrown off by a scene’s overall contrast, so a softly-lit but well-focused shot reads as sharp and a punchy but out-of-focus one reads as soft, on a clean 0 to 100 scale.
- `Fix` **The folder breakdown pop-up stays put.** In a folder or archive breakdown, the pop-up listing the files in a slice no longer vanishes the moment you scroll inside it - you can scroll its list freely, and only a scroll outside it closes it.

## 4.16 - Tamper Evident
*24 June 2026, 00:44*

- **Analyser learns to spot files that are not what they claim to be - flagging disguised and tampered files, finding data hidden after a file’s end, offering the full set of forensic fingerprints, and checking archive integrity. The header now counts files analysed, and spreadsheets point out the odd row.**
- `New` **Spot a file in disguise.** When a file’s real contents do not match its name - a program renamed to look like a photo, say - Analyser flags it the moment you open it and tells you what the file actually is. A file claiming a type its own bytes do not back up is called out the same way.
- `New` **Find data hidden after the end.** Analyser now detects extra data tacked on after a file’s real ending - a classic way to smuggle one file inside another, or to hide content a normal viewer ignores - for JPEG, PNG, GIF, BMP, WAV and ZIP files. It tells you how much is there and what it looks like.
- `New` **More fingerprints, on demand.** A file’s integrity panel now offers **MD5**, **SHA-1** and **SHA-512** alongside the existing SHA-256 - the fingerprints that forensic tools, antivirus databases and older checksum files rely on.
- `New` **Archive timing and integrity.** Open a .zip and a new panel charts when each file inside was last stamped, flagging archives that were repacked in one go or carry placeholder or future-dated entries. A button then recomputes every entry’s stored checksum to catch corruption or tampering.
- `New` **A private record of what you analysed.** The home page now keeps a short list of the files you have analysed recently - their names, sizes and types only, never the files themselves - stored on your own device alone and clearable any time. The latest ten are kept for a week.
- `New` **Spreadsheets flag the odd one out.** A .csv or spreadsheet now points out anomalies in your data - numbers far outside the rest, columns that never change, dates spaced too evenly to be real, and identifier-like columns - so unusual entries are easy to find.
- **The header now counts files analysed.** The running tally in the page header shows how many files Analyser has analysed, in place of the visitor count.

## 4.12 - 4.15 - Source & Circuit
*23 June 2026, 04:22*

- **KiCad circuit designs open as interactive schematics and boards, source code in almost any language opens as readable text, hundreds more game, machine-learning and developer formats are recognised, and plain-text files gain a full-text reader.**
- `New` **KiCad designs open.** A KiCad schematic (.kicad_sch), circuit board (.kicad_pcb), footprint (**.kicad_mod**) or symbol library (**.kicad_sym**) is rebuilt as an interactive drawing you can pan, zoom and fit, with the board’s copper, silkscreen, pads, tracks and outline switchable layer by layer. Open the project (**.kicad_pro**) and the schematic and board are tied together, so a part’s reference jumps between the two. Everything is rebuilt on your own device - nothing is uploaded.
- `New` **Simulation waveforms and fabrication netlists.** A SPICE **.raw** dump from KiCad’s ngspice or LTspice opens with its analysis type and every signal decoded and the traces drawn on a graph you can hover to read off values, and an IPC-D-356 netlist (**.ipc**) draws a fabrication map of every test point, coloured by net.
- `New` **Source code opens as text.** Drop a source file in almost any language - C and C++, C#, Java, Kotlin, Go, Rust, Python, Ruby, PHP, Swift and more - or the build and configuration files that fill a project (CMake, Makefiles, Docker, Git and npm dotfiles, GPU shaders, shell scripts) and it opens straight to a readable source preview with a line count.
- `New` **Hundreds more formats recognised.** Game files from Cyberpunk 2077 and The Witcher 3 (REDengine), Valve’s Source 2 (Counter-Strike 2, Dota 2, Deadlock, Half-Life: Alyx), Unity games and the classic Marathon trilogy are now named on sight - alongside ONNX machine-learning models, Node.js native add-ons and macOS dynamic libraries - each with its own guide page.
- `New` **Read a plain-text file in full.** A text or extensionless file now offers a **Show full text** button to open the whole thing rather than just a preview, and a `LICENSE` or `COPYING` file opens as clean plain text like a **.txt**, with its own full-screen reader.
- `Fix` **Clearer G-code playback speeds.** The G-code playback speed picker now labels its job-time column **Duration** instead of the ambiguous “Length”.
- **Polish** - the KiCad board and 3D model views render more cleanly, with a sweep of small fixes across the viewers.

## 4.08 - 4.11 - Printed Circuit
*22 June 2026, 00:14*

- **Altium circuit-board designs open as interactive schematics and boards, and the G-code visualiser learns travel moves and full-colour multi-material prints.**
- `New` **Altium Designer files open.** An Altium schematic (.SchDoc), circuit board (.PcbDoc), symbol library (**.SchLib**) or footprint library (**.PcbLib**) is rebuilt as an interactive vector view - the schematic symbols, wires and pins, or the board outline, copper, pads, tracks and arcs - that you can pan, zoom and switch on and off layer by layer. It reads out each component’s part number with its datasheet and supplier links, the pad table and the layers in use, and opens the project file (**.PrjPcb**) with the documents it ties together. Everything is rebuilt on your own device - nothing is uploaded.
- `New` **G-code travel moves, drawn in.** The .gcode viewer now shows the non-printing travel moves - where the head lifts and repositions between extrusions - woven in the true order the machine runs them, so you can see exactly how a print is stitched together.
- `New` **Multi-material prints in their real colours.** A multicolour or multi-material print now paints each move in its actual filament colour, read straight from the slicer’s own settings, with every tool change and colour swap followed through.
- `Faster` **Even the biggest prints draw whole.** Huge or arc-heavy prints - millions of segments - are capped to stay smooth, with how much is drawn scaled to your device’s memory, and a **Show full anyway** button redraws the entire object whenever you want every last detail.
- `Fix` **Quality controls stay within reach.** Showing a very large G-code file in full no longer greys out the render-quality buttons - the heavier settings simply start switched off, ready to turn back on whenever you like.

## 4.01 - 4.07 - Colour Grade
*21 June 2026, 03:50*

- **The stats page gains a usage graph over time, colour grades and Resolve timelines come alive, Windows libraries and extensionless files open, fonts show every script they cover, video gains frame-by-frame stepping, and hundreds more formats are recognised.**
- `New` **A usage graph on the stats page.** The stats page now plots visitors and files over time. Switch between a **per-day** view and a running **cumulative** total, click either label in the key to drop that line and watch the graph smoothly rescale to fit what is left, and hover any day to read off the exact figures in a little pop-up. The cumulative line carries on from the totals already banked before tracking began, so it climbs from the real figure rather than restarting at zero.
- `New` **Colour look-up tables, visualised.** Drop a .cube LUT and Analyser shows you what it actually does - the tone curve it bends, before-and-after swatches, how it shifts skin, sky and foliage, and an interactive 3D colour cube you can spin and look inside. Load your own photo or a video and the look is applied across eight frames, shown side by side and openable full-screen, so you can judge a grade before you ever use it.
- `New` **The grades inside a Resolve timeline, read out.** A DaVinci Resolve .drt timeline now lists each clip’s colour-grade node chain - every node in order, the LUTs it loads and the ResolveFX it applies - so you can see how a shot was graded without opening Resolve.
- `New` **Windows .lib libraries open.** A Microsoft COFF .lib - the library files Visual Studio and the MSVC linker produce - now opens and tells a true static library, carrying real compiled code, apart from a DLL import library, the stub that just points at a **.dll**. It reads the target architecture and lists the DLLs the library binds to and the objects inside.
- `New` **Files with no extension open as text.** A file with no extension at all - a `README`, a `COPYING`, a suffix-less config - now opens straight away as readable text, shown above the raw bytes, and if its contents look like a known format Analyser offers to open it that way instead of leaving you at a dead end.
- `New` **A sample of every script a font can write.** A font specimen now shows a sample sentence for each writing system the font actually covers - Japanese, Korean, Chinese, Cyrillic, Greek, Thai, Devanagari, Arabic and Hebrew - not just the Latin “quick brown fox”. Font collections (.ttc) let you preview each face inside, and Adobe Font List (**.lst**) files are read in full.
- `New` **Hundreds more formats recognised.** A broad sweep of new file types are named on sight - source code and build files, game-engine assets, electronics designs, runtime and backup files and more - bringing the total past 1,260. Every one gains its own format guide page.
- `Fix` **The folder openability scan now tells the truth.** Scanning a folder gives exactly the verdict you would get by dropping each file yourself - an extensionless file counts as openable, an unrecognised one is flagged - and a new button copies the path to every unsupported file at once, one per type, skipping cloud files that are not downloaded.
- `New` **Step through a video frame by frame.** A video now has **Prev frame** and **Next frame** buttons that move exactly one frame at a time in either direction, landing dead on each frame instead of drifting, and the frame you are looking at is pulled into the photo tools only when you ask - for its colours, dimensions and EXIF - rather than automatically.
- **A tidier header on phones and tablets.** On smaller screens the page header now lays its version, visitor and status details out in neat clusters instead of stacking awkwardly.

## 4.0 - Third Dimension  ·  milestone
*19 June 2026, 14:32*

- **Analyser steps into 3D: a full G-code visualiser for 3D printing and CNC milling, and a proper interactive viewer for 3D models - the biggest leap the workbench has taken.**
- `New` **See the object hidden inside a G-code file.** Drop a .gcode (or **.gco**, **.nc**, **.tap**, **.cnc**) and Analyser rebuilds the real printed or machined shape - every extruded move drawn as solid filament at its true width and height, the bare cutting path for CNC - in a viewer you can orbit, zoom and spin. Colour it by height, speed or the slicer’s own feature types - outer wall, infill, support and the rest - and peel it back layer by layer with the build-height slider. It works across every slicer (PrusaSlicer, SuperSlicer, OrcaSlicer, Cura, Bambu Studio, ideaMaker, Simplify3D) and reads back the object size, layer count and height, filament used, and the nozzle and bed temperatures.
- `New` **Watch it build.** Press play and the toolpath draws on from the first move to the last, a little toolhead tracing the way. Choose the pace from a pop-up - a fixed lines-per-second, the whole job inside a set number of seconds, or **real time**, where every move takes as long as it actually would on the machine and the total run time is shown up front.
- `New` **CNC milling programs, read properly.** A milling **.tap** or **.nc** now lists its whole tool table - every cutter with its diameter, type (flat, ball, chamfer and so on), spindle speed and the operations it runs - alongside the spindle direction, coolant and work-offset settings. Each tool’s cuts are drawn in their own colour, with buttons above the view to show or hide one tool at a time. Just as importantly, the full toolpath is reconstructed faithfully now, including the shorthand continuation moves CNC programs lean on, so what you see matches the finished part.
- `New` **A real 3D model viewer.** .stl, **.obj**, **.ply**, **.step**, **.3mf**, **.glb** and more open in an interactive viewer with an orientation cube in the corner you can grab to spin the model - or click a face, edge or corner to snap straight to that view. Switch between lifelike perspective and straight-on orthographic, flip on a wireframe to see how the mesh is built, and start every model the right way up, viewed from above. Wavefront material libraries (**.mtl**) are read too, listing each material and its colours.
- `New` **Read any table cell in full.** Click a cell in a .csv or a spreadsheet and its complete value pops up, labelled with its column or cell reference - handy when a long entry is clipped by the table.
- `New` **A guide for every format, and a clearer front door.** G-code and each 3D format gained its own plain-language guide page, so a search for “how to open a .tap file” lands somewhere useful, and the home page now says plainly what Analyser is: a G-code visualiser and 3D model viewer.
- `Faster` **A more useful offline download.** The **Everything** download now bundles EPS/PostScript graphics and AutoCAD drawings as well, leaving the heaviest **Complete** download as purely the extra OCR languages - so you only reach for it to recognise text in another language.
- `Fix` **Smoother build playback.** Pressing play now moves at a steady, true pace: a long, slow move draws on gradually with the toolhead gliding along it, instead of pausing in place and then snapping to the end.
- `Fix` **A clearer, steadier 3D view.** Prints and models now open framed to fill the viewer and centred on the part - no longer shrunk into a speck by a stray slicer purge line - and the flicker where stacked layers and walls overlapped is gone.
- **Polish** - optional anti-aliasing controls keep dense toolpaths crisp without the shimmer, a gentler default spin across every 3D view, and a sweep of viewer-control and layout tidying.

## 3.45 - 3.46 - Long Tail
*19 June 2026, 02:29*

- **Analyser now recognises over eighty more file types - more than 1,140 in all - and the newest Visual Studio solution format opens, alongside a sweep of polish across the format guides.**
- `New` **The newest Visual Studio solutions open.** A .slnx - the tidy XML solution file recent Visual Studio releases save in place of the old text one - now opens and lists every project it groups, each one’s language and the Debug and Release build configurations, just like the classic .sln.
- `New` **Over eighty more formats recognised.** A wide sweep of new file types across documents, developer and data files, archives, mapping, game assets, email, 3D and CAD, science and disk images are now named on sight - and the truly obscure ones get a place of their own in a new **Niche and rare formats** group. Every one has its own format guide page.
- **Maintenance** - the format guide pages now carry the live visitor count and link to the changelog, the light and dark switch announces itself to screen readers, the formats list is grouped more accurately, and a pass of small consistency fixes went across page titles, descriptions and tidy-up under the hood.

## 3.37 - 3.44 - Home Movies
*18 June 2026, 14:12*

- **Camcorder video now opens and plays in the browser, alongside a round of behind-the-scenes tidying.**
- `New` **AVCHD camcorder clips play.** An .mts or **.m2ts** clip - the AVCHD video a Sony, Panasonic or Canon camcorder records to disc or memory card - now plays straight away. Analyser repackages it into a browser-friendly MP4 on your own device, leaving the original picture untouched and only re-coding the sound, so even a long clip starts without waiting for the whole video to convert.
- **Maintenance** - a sweep of internal tidying: unused code removed, shared helpers brought together, a safeguard so one misbehaving format can no longer interrupt a file’s analysis, and the styling and theme set-up single-sourced across the site.

## 3.33 - 3.36 - Fine Tuning
*18 June 2026, 05:45*

- **A rebuilt About page that explains Analyser at a glance and gives Office documents their own place - plus a sweep of small fixes and tidying under the hood.**
- `New` **A clearer About page.** The About page now opens with a short walkthrough of how Analyser works and an expanded set of common questions, and gives **Office documents and presentations** - Word, Excel, PowerPoint and PDF - a prominent place in the list of what opens.
- `Fix` **A few formats are recognised correctly now.** An .nsf is identified as **NES game music** rather than confused with a Lotus Notes database, and a couple of header reads were corrected so more files name the right application and version.
- **Maintenance** - a thorough pass over the code’s internal comments, every format guide page brought in line with the rest of the site’s link previews, and groundwork notes for future tidying.
